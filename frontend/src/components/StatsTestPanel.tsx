"use client";

import { useCallback, useState } from "react";
import type { ApiErrorBody, ColumnProfile, TestResult, TestType } from "@/lib/types";

const TEST_TYPE_LABELS: Record<TestType, string> = {
  t_test: "t-test",
  chi_square: "Chi-square",
  anova: "ANOVA",
};

const SELECT_STYLES =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-black shadow-sm transition-colors focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50";

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function StatsTestPanel({ datasetId, columns }: { datasetId: string; columns: ColumnProfile[] }) {
  const [columnA, setColumnA] = useState(columns[0]?.column_name ?? "");
  const [columnB, setColumnB] = useState(columns[1]?.column_name ?? columns[0]?.column_name ?? "");
  const [results, setResults] = useState<TestResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const runTest = useCallback(async () => {
    setError(null);
    if (columnA === columnB) {
      setError("Choose two different columns to run a test.");
      return;
    }

    setIsRunning(true);
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;

    try {
      const res = await fetch(`${apiUrl}/api/datasets/${datasetId}/tests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ column_a: columnA, column_b: columnB }),
      });

      if (!res.ok) {
        const body = (await res.json()) as ApiErrorBody;
        setError(body.error?.message ?? "Couldn't run that test.");
        return;
      }

      const result = (await res.json()) as TestResult;
      setResults((prev) => [result, ...prev]);
    } catch {
      setError("Could not reach the backend. Please try again.");
    } finally {
      setIsRunning(false);
    }
  }, [datasetId, columnA, columnB]);

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-zinc-200/70 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="font-semibold text-black dark:text-zinc-50">Statistical Testing</h2>
      <p className="text-sm text-zinc-500">
        Pick two columns — the test (t-test, ANOVA, or chi-square) is chosen automatically based on their data types.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-500">Column A</span>
          <select value={columnA} onChange={(e) => setColumnA(e.target.value)} className={SELECT_STYLES}>
            {columns.map((c) => (
              <option key={c.column_name} value={c.column_name}>
                {c.column_name} ({c.data_type})
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-500">Column B</span>
          <select value={columnB} onChange={(e) => setColumnB(e.target.value)} className={SELECT_STYLES}>
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
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isRunning ? "Running…" : "Run Test"}
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </p>
      )}

      {results.length > 0 && (
        <div className="flex flex-col gap-3">
          {results.map((r) => {
            const isSignificant = r.p_value < 0.05;
            return (
              <div
                key={r.id}
                className="flex flex-col gap-1.5 rounded-xl border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800/60 dark:bg-zinc-950/40"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-950/50 dark:text-blue-300">
                      {TEST_TYPE_LABELS[r.test_type]}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                        isSignificant
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                          : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${isSignificant ? "bg-emerald-500" : "bg-zinc-400"}`} />
                      {isSignificant ? "Significant" : "Not significant"}
                    </span>
                  </div>
                  <span className="text-xs text-zinc-500">{formatTimestamp(r.created_at)}</span>
                </div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  <span className="font-medium text-black dark:text-zinc-50">{r.column_a}</span> vs{" "}
                  <span className="font-medium text-black dark:text-zinc-50">{r.column_b}</span> — statistic{" "}
                  <span className="tabular-nums">{r.statistic.toFixed(4)}</span>, p-value{" "}
                  <span className="tabular-nums">{r.p_value.toFixed(4)}</span>
                </p>
                <p className="text-sm text-black dark:text-zinc-50">{r.conclusion}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
