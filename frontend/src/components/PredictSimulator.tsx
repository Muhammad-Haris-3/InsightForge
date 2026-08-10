"use client";

import { useEffect, useMemo, useState } from "react";
import type { ApiErrorBody, ColumnProfile, EdaReport, ModelRun, Prediction } from "@/lib/types";

const DEBOUNCE_MS = 400;

const SELECT_STYLES =
  "rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-black shadow-sm transition-colors focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50";

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
    const timer = setTimeout(() => {
      setError(null);
      setIsPredicting(true);
      const apiUrl = process.env.NEXT_PUBLIC_API_URL;

      fetch(`${apiUrl}/api/datasets/${datasetId}/model/${run.id}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ features: values }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const body = (await res.json()) as ApiErrorBody;
            setError(body.error?.message ?? "Couldn't get a prediction.");
            return;
          }
          setPrediction((await res.json()) as Prediction);
        })
        .catch(() => setError("Could not reach the backend. Please try again."))
        .finally(() => setIsPredicting(false));
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [values, datasetId, run.id]);

  if (featureColumns.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-1.5">
        <svg viewBox="0 0 20 20" className="h-4 w-4 text-emerald-600 dark:text-emerald-400" fill="currentColor" aria-hidden="true">
          <path d="M10 2a1 1 0 0 1 1 1v1.06a6.5 6.5 0 0 1 5.94 5.94H18a1 1 0 1 1 0 2h-1.06A6.5 6.5 0 0 1 11 17.94V19a1 1 0 1 1-2 0v-1.06A6.5 6.5 0 0 1 3.06 12H2a1 1 0 1 1 0-2h1.06A6.5 6.5 0 0 1 9 4.06V3a1 1 0 0 1 1-1Zm0 4.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" />
        </svg>
        <h4 className="text-sm font-semibold text-black dark:text-zinc-50">What-If Simulator</h4>
      </div>
      <p className="text-xs text-zinc-500">Adjust the inputs and see this model&apos;s live prediction update.</p>

      <div className="flex flex-col gap-3.5">
        {featureColumns.map((col) => {
          if (col.data_type === "numeric") {
            const stats = numericStats(col);
            const min = stats?.min ?? 0;
            const max = stats?.max ?? 100;
            const step = max > min ? Math.max((max - min) / 100, 0.01) : 1;
            const current = Number(values[col.column_name] ?? min);
            return (
              <label key={col.column_name} className="flex flex-col gap-1.5 text-xs">
                <span className="flex justify-between">
                  <span className="text-zinc-500">{col.column_name}</span>
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-medium tabular-nums text-black dark:bg-zinc-800 dark:text-zinc-50">
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
                  className="h-1.5 cursor-pointer accent-emerald-600"
                />
              </label>
            );
          }

          const options = categoricalOptions(eda, col.column_name);
          return (
            <label key={col.column_name} className="flex flex-col gap-1.5 text-xs">
              <span className="text-zinc-500">{col.column_name}</span>
              <select
                value={String(values[col.column_name] ?? "")}
                onChange={(e) => setValues((prev) => ({ ...prev, [col.column_name]: e.target.value }))}
                className={SELECT_STYLES}
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
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </p>
      )}

      {prediction && (
        <div className="flex flex-col gap-2 rounded-lg border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white px-3.5 py-3 dark:border-emerald-900 dark:from-emerald-950/30 dark:to-zinc-900">
          <div className={`flex items-baseline gap-1.5 transition-opacity ${isPredicting ? "opacity-50" : ""}`}>
            <span className="text-xs text-zinc-500">Predicted {run.target_column}</span>
          </div>
          <span className={`text-xl font-semibold text-black transition-opacity dark:text-zinc-50 ${isPredicting ? "opacity-50" : ""}`}>
            {typeof prediction.prediction === "number"
              ? prediction.prediction.toLocaleString()
              : displayLabel(prediction.prediction)}
          </span>
          {prediction.probabilities && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(prediction.probabilities).map(([label, p]) => (
                <span
                  key={label}
                  className="rounded-full bg-white px-2 py-0.5 text-xs text-zinc-600 shadow-sm dark:bg-zinc-800 dark:text-zinc-300"
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
