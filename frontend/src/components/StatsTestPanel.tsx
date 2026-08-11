"use client";

import { useCallback, useState } from "react";
import type { ColumnProfile, TestResult, TestType } from "@/lib/types";
import { apiFetch, toErrorMessage } from "@/lib/api";

const TEST_TYPE_LABELS: Record<TestType, string> = {
  t_test: "t-test",
  chi_square: "Chi-square",
  anova: "ANOVA",
};

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function StatsTestPanel({ datasetId, columns }: { datasetId: string; columns: ColumnProfile[] }) {
  const [columnA, setColumnA] = useState(columns[0]?.column_name ?? "");
  const [columnB, setColumnB] = useState(columns[1]?.column_name ?? columns[0]?.column_name ?? "");
  const [results, setResults] = useState<TestResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  const runTest = useCallback(async () => {
    setError(null);
    if (columnA === columnB) {
      setError("Choose two different columns to run a test.");
      return;
    }

    setIsRunning(true);
    setIsRetrying(false);

    try {
      const res = await apiFetch(`/api/datasets/${datasetId}/tests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column_a: columnA, column_b: columnB }),
        onRetry: () => setIsRetrying(true),
      });

      const result = (await res.json()) as TestResult;
      setResults((prev) => [result, ...prev]);
    } catch (err) {
      setError(toErrorMessage(err, "Couldn't run that test."));
    } finally {
      setIsRunning(false);
      setIsRetrying(false);
    }
  }, [datasetId, columnA, columnB]);

  return (
    <div className="glass-card flex flex-col gap-5 rounded-2xl p-6">
      <div>
        <h2 className="font-semibold text-slate-100 text-lg">Statistical Testing</h2>
        <p className="text-sm text-slate-500 mt-1">
          Pick two columns — the test (t-test, ANOVA, or chi-square) is chosen automatically based on their data types.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-slate-400 text-xs uppercase tracking-wider">Column A</span>
          <select value={columnA} onChange={(e) => setColumnA(e.target.value)} className="select-styled">
            {columns.map((c) => (
              <option key={c.column_name} value={c.column_name}>
                {c.column_name} ({c.data_type})
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-slate-400 text-xs uppercase tracking-wider">Column B</span>
          <select value={columnB} onChange={(e) => setColumnB(e.target.value)} className="select-styled">
            {columns.map((c) => (
              <option key={c.column_name} value={c.column_name}>
                {c.column_name} ({c.data_type})
              </option>
            ))}
          </select>
        </label>

        <button
          onClick={() => void runTest()}
          disabled={isRunning || !columnA || !columnB}
          className="btn-primary rounded-xl px-5 py-2.5 text-sm font-medium"
        >
          {isRunning ? (isRetrying ? "Waking the backend…" : "Running…") : "Run Test"}
        </button>
      </div>

      {error && (
        <div className="error-card rounded-xl px-4 py-3 text-sm animate-fadeIn">
          {error}
        </div>
      )}

      {results.length > 0 && (
        <div className="flex flex-col gap-3">
          {results.map((r) => {
            const isSignificant = r.p_value < 0.05;
            return (
              <div
                key={r.id}
                className="glass-inner flex flex-col gap-2 rounded-xl p-4 animate-fadeInUp"
                style={{
                  borderLeft: `3px solid ${isSignificant ? "rgba(52,211,153,0.5)" : "rgba(148,163,184,0.15)"}`,
                }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="badge bg-blue-500/15 text-blue-300 border border-blue-500/20">
                      {TEST_TYPE_LABELS[r.test_type]}
                    </span>
                    <span
                      className={`badge ${
                        isSignificant
                          ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20"
                          : "bg-slate-500/15 text-slate-400 border border-slate-500/20"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${isSignificant ? "bg-emerald-400" : "bg-slate-500"}`} />
                      {isSignificant ? "Significant" : "Not significant"}
                    </span>
                  </div>
                  <span className="text-xs text-slate-600 font-mono">{formatTimestamp(r.created_at)}</span>
                </div>
                <p className="text-sm text-slate-400">
                  <span className="font-medium text-slate-200">{r.column_a}</span> vs{" "}
                  <span className="font-medium text-slate-200">{r.column_b}</span> — statistic{" "}
                  <span className="tabular-nums font-mono text-slate-300">{r.statistic.toFixed(4)}</span>, p-value{" "}
                  <span className="tabular-nums font-mono text-slate-300">{r.p_value.toFixed(4)}</span>
                </p>
                <p className="text-sm text-slate-300">{r.conclusion}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
