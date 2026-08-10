"use client";

import { useCallback, useState } from "react";
import type { ApiErrorBody } from "@/lib/types";

function sanitizeFilenameStem(name: string): string {
  const stem = name.replace(/\.[^.]+$/, "");
  return stem.replace(/[^A-Za-z0-9._ -]/g, "_") || "dataset";
}

export function ReportExportButton({ datasetId, filename }: { datasetId: string; filename: string }) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = useCallback(async () => {
    setError(null);
    setIsDownloading(true);
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;

    try {
      const res = await fetch(`${apiUrl}/api/datasets/${datasetId}/report/pdf`, { credentials: "include" });

      if (!res.ok) {
        const body = (await res.json()) as ApiErrorBody;
        setError(body.error?.message ?? "Couldn't generate the PDF report.");
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${sanitizeFilenameStem(filename)}_insightforge_report.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Could not reach the backend. Please try again.");
    } finally {
      setIsDownloading(false);
    }
  }, [datasetId, filename]);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="font-semibold text-black dark:text-zinc-50">Export</h2>
      <p className="text-sm text-zinc-500">
        Download a PDF summary of the data-quality report, EDA correlation matrix, and any statistical tests or
        baseline models run so far.
      </p>
      <button
        onClick={() => void download()}
        disabled={isDownloading}
        className="self-start rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-black hover:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:border-zinc-600"
      >
        {isDownloading ? "Generating PDF…" : "Download PDF Report"}
      </button>
      {error && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
