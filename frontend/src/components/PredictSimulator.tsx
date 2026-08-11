"use client";

import { useEffect, useMemo, useState } from "react";
import type { ColumnProfile, EdaReport, ModelRun, Prediction } from "@/lib/types";
import { apiFetch, toErrorMessage } from "@/lib/api";

const DEBOUNCE_MS = 400;

function numericStats(col: ColumnProfile): { min: number; max: number; mean: number } | null {
  const s = col.summary_stats as Record<string, number | null> | null;
  if (!s || s.min == null || s.max == null) return null;
  return { min: s.min, max: s.max, mean: s.mean ?? (s.min + s.max) / 2 };
}

function categoricalOptions(eda: EdaReport | null, columnName: string): string[] {
  const freq = eda?.categorical_frequencies.find((f) => f.column_name === columnName);
  return freq ? freq.categories.map((c) => c.value) : [];
}

// The backend normalizes classification target labels to lowercase for
// matching purposes (see modeling.py::_clean_target) so a predicted class
// comes back e.g. "lahore" — capitalize it for display so it reads
// consistently with the capitalized values shown everywhere else in the UI.
function displayLabel(value: string): string {
  return value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

export function PredictSimulator({
  datasetId,
  run,
  columns,
  eda,
}: {
  datasetId: string;
  run: ModelRun;
  columns: ColumnProfile[];
  eda: EdaReport | null;
}) {
  const featureColumns = useMemo(() => {
    const names = Object.keys(run.feature_importance ?? {});
    return names.map((name) => columns.find((c) => c.column_name === name)).filter((c): c is ColumnProfile => !!c);
  }, [run.feature_importance, columns]);

  const [values, setValues] = useState<Record<string, string | number>>(() => {
    const initial: Record<string, string | number> = {};
    for (const col of featureColumns) {
      if (col.data_type === "numeric") {
        const stats = numericStats(col);
        initial[col.column_name] = stats ? Math.round(stats.mean * 100) / 100 : 0;
      } else {
        const options = categoricalOptions(eda, col.column_name);
        const summary = col.summary_stats as { top_value?: string } | null;
        initial[col.column_name] = summary?.top_value ?? options[0] ?? "";
      }
    }
    return initial;
  });

  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPredicting, setIsPredicting] = useState(false);

  useEffect(() => {
    // One controller per debounced run: moving a slider again aborts the request
    // still in flight, so a slow reply can't land after a newer one and leave the
    // card showing a prediction for inputs the user has already changed.
    const controller = new AbortController();

    const timer = setTimeout(async () => {
      setError(null);
      setIsPredicting(true);

      try {
        const res = await apiFetch(`/api/datasets/${datasetId}/model/${run.id}/predict`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ features: values }),
          signal: controller.signal,
          // No backoff here — this fires off slider input, and a superseded
          // request should die rather than wait out a cold-start retry schedule.
          retries: 0,
        });
        setPrediction((await res.json()) as Prediction);
      } catch (err) {
        if (controller.signal.aborted) return; // superseded — leave the UI alone
        setError(toErrorMessage(err, "Couldn't get a prediction."));
      } finally {
        if (!controller.signal.aborted) setIsPredicting(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [values, datasetId, run.id]);

  if (featureColumns.length === 0) return null;

  return (
    <div className="glass-inner flex flex-col gap-4 rounded-xl p-4">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15">
          <svg viewBox="0 0 20 20" className="h-4 w-4 text-emerald-400" fill="currentColor" aria-hidden="true">
            <path d="M10 2a1 1 0 0 1 1 1v1.06a6.5 6.5 0 0 1 5.94 5.94H18a1 1 0 1 1 0 2h-1.06A6.5 6.5 0 0 1 11 17.94V19a1 1 0 1 1-2 0v-1.06A6.5 6.5 0 0 1 3.06 12H2a1 1 0 1 1 0-2h1.06A6.5 6.5 0 0 1 9 4.06V3a1 1 0 0 1 1-1Zm0 4.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" />
          </svg>
        </div>
        <div>
          <h4 className="text-sm font-semibold text-slate-200">What-If Simulator</h4>
          <p className="text-xs text-slate-500">Adjust the inputs and see this model&apos;s live prediction update.</p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {featureColumns.map((col) => {
          if (col.data_type === "numeric") {
            const stats = numericStats(col);
            const min = stats?.min ?? 0;
            const max = stats?.max ?? 100;
            const step = max > min ? Math.max((max - min) / 100, 0.01) : 1;
            const current = Number(values[col.column_name] ?? min);
            return (
              <label key={col.column_name} className="flex flex-col gap-2 text-xs">
                <span className="flex justify-between items-center">
                  <span className="text-slate-400">{col.column_name}</span>
                  <span className="rounded-md bg-slate-800/80 border border-slate-700/50 px-2 py-0.5 font-medium tabular-nums text-slate-200 font-mono text-xs">
                    {current}
                  </span>
                </span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={current}
                  onChange={(e) => setValues((prev) => ({ ...prev, [col.column_name]: Number(e.target.value) }))}
                />
              </label>
            );
          }

          const options = categoricalOptions(eda, col.column_name);
          return (
            <label key={col.column_name} className="flex flex-col gap-1.5 text-xs">
              <span className="text-slate-400">{col.column_name}</span>
              <select
                value={String(values[col.column_name] ?? "")}
                onChange={(e) => setValues((prev) => ({ ...prev, [col.column_name]: e.target.value }))}
                className="select-styled"
              >
                {options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>

      {error && (
        <div className="error-card rounded-lg px-3 py-2 text-xs animate-fadeIn">
          {error}
        </div>
      )}

      {prediction && (
        <div className="prediction-card flex flex-col gap-2 animate-fadeIn">
          <div className={`flex items-baseline gap-1.5 transition-opacity duration-300 ${isPredicting ? "opacity-40" : ""}`}>
            <span className="text-xs text-slate-400">Predicted {run.target_column}</span>
          </div>
          <span className={`text-2xl font-bold text-slate-100 transition-opacity duration-300 ${isPredicting ? "opacity-40" : ""}`}>
            {typeof prediction.prediction === "number"
              ? prediction.prediction.toLocaleString()
              : displayLabel(prediction.prediction)}
          </span>
          {prediction.probabilities && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(prediction.probabilities).map(([label, p]) => (
                <span
                  key={label}
                  className="badge bg-slate-800/60 text-slate-300 border border-slate-700/40"
                >
                  {displayLabel(label)} {(p * 100).toFixed(0)}%
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
