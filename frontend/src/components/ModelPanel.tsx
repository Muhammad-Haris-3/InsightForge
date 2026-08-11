"use client";

import { useCallback, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ColumnProfile, EdaReport, ModelRun } from "@/lib/types";
import { apiFetch, toErrorMessage } from "@/lib/api";
import { PredictSimulator } from "@/components/PredictSimulator";

const MODEL_TYPE_LABELS: Record<string, string> = { regression: "Regression", classification: "Classification" };

const METRIC_LABELS: Record<string, string> = {
  r2: "R²",
  mae: "MAE",
  rmse: "RMSE",
  accuracy: "Accuracy",
  precision: "Precision",
  recall: "Recall",
  f1: "F1",
};

// Validated categorical slot 2 (orange) — dataviz skill palette.md — kept
// distinct from the blue/aqua used by the EDA charts (histograms/frequency).
const IMPORTANCE_COLOR = "#fb923c"; // brighter orange for dark bg

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

function FeatureImportanceChart({ importance }: { importance: Record<string, number> }) {
  const data = Object.entries(importance)
    .sort((a, b) => b[1] - a[1])
    .map(([column, value]) => ({ column, "Importance (%)": Math.round(value * 1000) / 10 }));

  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 32)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.06)" />
        <XAxis
          type="number"
          domain={[0, 100]}
          tickFormatter={(v: number) => `${v}%`}
          tick={{ fontSize: 10, fill: "#64748b" }}
        />
        <YAxis type="category" dataKey="column" width={90} tick={{ fontSize: 10, fill: "#94a3b8" }} />
        <Tooltip
          contentStyle={{
            fontSize: 12,
            borderRadius: 8,
            background: "rgba(15,23,42,0.95)",
            border: "1px solid rgba(148,163,184,0.1)",
            color: "#e2e8f0",
          }}
          cursor={{ fill: "rgba(251, 146, 60, 0.06)" }}
        />
        <Bar dataKey="Importance (%)" fill={IMPORTANCE_COLOR} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ModelPanel({
  datasetId,
  columns,
  eda,
}: {
  datasetId: string;
  columns: ColumnProfile[];
  eda: EdaReport | null;
}) {
  const targetableColumns = useMemo(
    () => columns.filter((c) => c.data_type === "numeric" || c.data_type === "categorical" || c.data_type === "boolean"),
    [columns],
  );
  const [targetColumn, setTargetColumn] = useState(targetableColumns[0]?.column_name ?? "");
  const [runs, setRuns] = useState<ModelRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isTraining, setIsTraining] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  const trainModel = useCallback(async () => {
    setError(null);
    setIsTraining(true);
    setIsRetrying(false);

    try {
      const res = await apiFetch(`/api/datasets/${datasetId}/model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_column: targetColumn }),
        onRetry: () => setIsRetrying(true),
      });

      const run = (await res.json()) as ModelRun;
      setRuns((prev) => [run, ...prev]);
    } catch (err) {
      setError(toErrorMessage(err, "Couldn't train a model on this column."));
    } finally {
      setIsTraining(false);
      setIsRetrying(false);
    }
  }, [datasetId, targetColumn]);

  if (targetableColumns.length === 0) return null;

  return (
    <div className="glass-card flex flex-col gap-5 rounded-2xl p-6">
      <div>
        <h2 className="font-semibold text-slate-100 text-lg">Baseline Model</h2>
        <p className="text-sm text-slate-500 mt-1">
          Pick a target column — a numeric target trains a regression model, a categorical/boolean target trains a
          classifier, both via a random forest with an 80/20 train/test split.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-slate-400 text-xs uppercase tracking-wider">Target column</span>
          <select value={targetColumn} onChange={(e) => setTargetColumn(e.target.value)} className="select-styled">
            {targetableColumns.map((c) => (
              <option key={c.column_name} value={c.column_name}>
                {c.column_name} ({c.data_type})
              </option>
            ))}
          </select>
        </label>

        <button
          onClick={() => void trainModel()}
          disabled={isTraining || !targetColumn}
          className="btn-primary rounded-xl px-5 py-2.5 text-sm font-medium"
        >
          {isTraining ? (isRetrying ? "Waking the backend…" : "Training…") : "Train Model"}
        </button>
      </div>

      {error && (
        <div className="error-card rounded-xl px-4 py-3 text-sm animate-fadeIn">
          {error}
        </div>
      )}

      {runs.length > 0 && (
        <div className="flex flex-col gap-4">
          {runs.map((run) => (
            <div
              key={run.id}
              className="glass-inner flex flex-col gap-4 rounded-xl p-5 animate-fadeInUp"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="badge bg-orange-500/15 text-orange-300 border border-orange-500/20">
                    {MODEL_TYPE_LABELS[run.model_type] ?? run.model_type}
                  </span>
                  <span className="text-sm font-medium text-slate-200">target: {run.target_column}</span>
                </div>
                <span className="text-xs text-slate-600 font-mono">{formatTimestamp(run.created_at)}</span>
              </div>

              <dl className="flex flex-wrap gap-3">
                {Object.entries(run.metrics).map(([key, value]) => (
                  <div key={key} className="stat-card">
                    <dt className="text-xs text-slate-500 uppercase tracking-wider">{METRIC_LABELS[key] ?? key}</dt>
                    <dd className="font-semibold tabular-nums text-slate-100 font-mono mt-0.5">{value.toFixed(4)}</dd>
                  </div>
                ))}
              </dl>

              <p className="text-sm text-slate-300">{run.feature_importance_summary}</p>

              {/* Say so when the metrics came from a sample. A large upload is capped
                  before fitting to bound memory, and quietly reporting sample metrics
                  as if they covered the whole file would be misleading. */}
              {run.training_row_count != null &&
                run.available_row_count != null &&
                run.training_row_count < run.available_row_count && (
                  <p className="text-xs text-slate-500">
                    Trained on a random sample of {run.training_row_count.toLocaleString()} of{" "}
                    {run.available_row_count.toLocaleString()} rows, so the model fits within the backend&apos;s memory
                    limit. Metrics and importances describe that sample.
                  </p>
                )}

              {run.feature_importance && Object.keys(run.feature_importance).length > 0 && (
                <FeatureImportanceChart importance={run.feature_importance} />
              )}

              <div className="section-divider" />

              <PredictSimulator datasetId={datasetId} run={run} columns={columns} eda={eda} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
