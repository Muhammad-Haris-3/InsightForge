"use client";

import { useCallback, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ApiErrorBody, ColumnProfile, ModelRun } from "@/lib/types";

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
        <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
        <XAxis type="number" domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 10 }} />
        <YAxis type="category" dataKey="column" width={90} tick={{ fontSize: 10 }} />
        <Tooltip contentStyle={{ fontSize: 12 }} />
        <Bar dataKey="Importance (%)" fill="#f59e0b" radius={[0, 2, 2, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ModelPanel({ datasetId, columns }: { datasetId: string; columns: ColumnProfile[] }) {
  const targetableColumns = useMemo(
    () => columns.filter((c) => c.data_type === "numeric" || c.data_type === "categorical" || c.data_type === "boolean"),
    [columns],
  );
  const [targetColumn, setTargetColumn] = useState(targetableColumns[0]?.column_name ?? "");
  const [runs, setRuns] = useState<ModelRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isTraining, setIsTraining] = useState(false);

  const trainModel = useCallback(async () => {
    setError(null);
    setIsTraining(true);
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;

    try {
      const res = await fetch(`${apiUrl}/api/datasets/${datasetId}/model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ target_column: targetColumn }),
      });

      if (!res.ok) {
        const body = (await res.json()) as ApiErrorBody;
        setError(body.error?.message ?? "Couldn't train a model on this column.");
        return;
      }

      const run = (await res.json()) as ModelRun;
      setRuns((prev) => [run, ...prev]);
    } catch {
      setError("Could not reach the backend. Please try again.");
    } finally {
      setIsTraining(false);
    }
  }, [datasetId, targetColumn]);

  if (targetableColumns.length === 0) return null;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="font-semibold text-black dark:text-zinc-50">Baseline Model</h2>
      <p className="text-sm text-zinc-500">
        Pick a target column — a numeric target trains a regression model, a categorical/boolean target trains a
        classifier, both via a random forest with an 80/20 train/test split.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-500">Target column</span>
          <select
            value={targetColumn}
            onChange={(e) => setTargetColumn(e.target.value)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-black dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
          >
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
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isTraining ? "Training…" : "Train Model"}
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </p>
      )}

      {runs.length > 0 && (
        <div className="flex flex-col gap-4">
          {runs.map((run) => (
            <div
              key={run.id}
              className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950/40"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                    {MODEL_TYPE_LABELS[run.model_type] ?? run.model_type}
                  </span>
                  <span className="text-sm font-medium text-black dark:text-zinc-50">target: {run.target_column}</span>
                </div>
                <span className="text-xs text-zinc-500">{formatTimestamp(run.created_at)}</span>
              </div>

              <dl className="flex flex-wrap gap-4 text-sm">
                {Object.entries(run.metrics).map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-zinc-500">{METRIC_LABELS[key] ?? key}</dt>
                    <dd className="font-semibold text-black dark:text-zinc-50">{value.toFixed(4)}</dd>
                  </div>
                ))}
              </dl>

              <p className="text-sm text-black dark:text-zinc-50">{run.feature_importance_summary}</p>

              {run.feature_importance && Object.keys(run.feature_importance).length > 0 && (
                <FeatureImportanceChart importance={run.feature_importance} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
