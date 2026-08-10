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
    <div className="glass-card flex flex-col gap-4 rounded-2xl p-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-red-500/10 border border-red-500/20">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-red-400" fill="none" aria-hidden="true">
              <path
                d="M7 3.5h7l3.5 3.5V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path d="M14 3.5V7a1 1 0 0 0 1 1h3.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M8.5 13h7M8.5 16h4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <h2 className="font-semibold text-slate-100 text-lg">Export</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              A PDF summary of the data-quality report, EDA correlation matrix, and any statistical tests or baseline
              models run so far.
            </p>
          </div>
        </div>
        <button
          onClick={() => void download()}
          disabled={isDownloading}
          className="btn-secondary flex flex-shrink-0 items-center gap-2 self-start rounded-xl px-5 py-2.5 text-sm font-medium sm:self-auto disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isDownloading ? (
            <>
              <svg className="h-4 w-4 animate-spin-custom" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v3a5 5 0 0 0-5 5H4Z" />
              </svg>
              Generating PDF…
            </>
          ) : (
            <>
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
                <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
              </svg>
              Download PDF Report
            </>
          )}
        </button>
      </div>
      {error && (
        <div className="error-card rounded-xl px-4 py-3 text-sm animate-fadeIn">
          {error}
        </div>
      )}
    </div>
  );
}
