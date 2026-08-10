"use client";

import { useCallback, useRef, useState } from "react";
import type { ApiErrorBody, QualityReport } from "@/lib/types";
import { QualityReportView } from "@/components/QualityReportView";
import { EdaView } from "@/components/EdaView";
import { StatsTestPanel } from "@/components/StatsTestPanel";
import { ModelPanel } from "@/components/ModelPanel";
import { ReportExportButton } from "@/components/ReportExportButton";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

type Status = "idle" | "uploading" | "error";

export function UploadPanel() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<QualityReport | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setStatus("error");
      setError("Only .csv files are accepted.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setStatus("error");
      setError("File exceeds the 10MB upload limit.");
      return;
    }

    setStatus("uploading");
    setError(null);
    setReport(null);

    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${apiUrl}/api/datasets/upload`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!res.ok) {
        const body = (await res.json()) as ApiErrorBody;
        setStatus("error");
        setError(body.error?.message ?? "Upload failed.");
        return;
      }

      // The EDA payload rides along in this same response (see backend
      // upload_dataset) — no separate cross-site request needed, so the charts
      // show up even for visitors whose browser blocks third-party cookies.
      const data = (await res.json()) as QualityReport;
      setReport(data);
      setStatus("idle");
    } catch {
      setStatus("error");
      setError("Could not reach the backend. Please try again.");
    }
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragOver(false);
      const file = event.dataTransfer.files?.[0];
      if (file) void upload(file);
    },
    [upload],
  );

  const onFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) void upload(file);
      event.target.value = "";
    },
    [upload],
  );

  return (
    <div className="flex w-full max-w-3xl flex-col gap-8">
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-14 text-center shadow-sm transition-all duration-150 ${
          isDragOver
            ? "scale-[1.01] border-emerald-500 bg-emerald-50 shadow-emerald-500/10 dark:bg-emerald-950/20"
            : "border-zinc-300 bg-white hover:border-emerald-400 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-emerald-600"
        }`}
      >
        <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={onFileChange} />
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors ${
            isDragOver ? "bg-emerald-100 dark:bg-emerald-900/40" : "bg-zinc-100 dark:bg-zinc-800"
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            className={`h-6 w-6 ${isDragOver ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-500"}`}
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M12 16V4m0 0 4 4m-4-4-4 4"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <p className="font-medium text-black dark:text-zinc-50">
          {status === "uploading" ? "Uploading…" : "Drop a CSV here, or click to browse"}
        </p>
        <p className="text-sm text-zinc-500">Max 10MB · .csv only</p>
      </div>

      {error && (
        <p className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
          <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 flex-shrink-0" fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.63-1.516 2.63H3.72c-1.347 0-2.189-1.463-1.515-2.63L8.485 2.495ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
              clipRule="evenodd"
            />
          </svg>
          {error}
        </p>
      )}

      {report && <QualityReportView report={report} />}
      {report?.eda && <EdaView eda={report.eda} />}
      {report && report.columns.length >= 2 && (
        <StatsTestPanel key={`tests-${report.id}`} datasetId={report.id} columns={report.columns} />
      )}
      {report && (
        <ModelPanel key={`model-${report.id}`} datasetId={report.id} columns={report.columns} eda={report.eda ?? null} />
      )}
      {report && (
        <ReportExportButton key={`export-${report.id}`} datasetId={report.id} filename={report.original_filename} />
      )}
    </div>
  );
}
