"use client";

import { useCallback, useRef, useState } from "react";
import type { QualityReport } from "@/lib/types";
import { apiFetch, toErrorMessage } from "@/lib/api";
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
  const [isRetrying, setIsRetrying] = useState(false);
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
    setIsRetrying(false);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await apiFetch("/api/datasets/upload", {
        method: "POST",
        body: formData,
        onRetry: () => setIsRetrying(true),
      });

      // The EDA payload rides along in this same response (see backend
      // upload_dataset) — no separate cross-site request needed, so the charts
      // show up even for visitors whose browser blocks third-party cookies.
      const data = (await res.json()) as QualityReport;
      setReport(data);
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      setError(toErrorMessage(err, "Upload failed."));
    } finally {
      setIsRetrying(false);
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
    <div className="flex w-full max-w-3xl flex-col gap-8 animate-fadeInUp delay-200">
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
        className={`upload-zone flex cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl px-6 py-16 text-center ${
          isDragOver ? "drag-over" : ""
        }`}
      >
        <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={onFileChange} />
        <div
          className={`flex h-14 w-14 items-center justify-center rounded-xl transition-all duration-300 ${
            isDragOver
              ? "bg-emerald-500/20 shadow-[0_0_20px_rgba(52,211,153,0.2)]"
              : "bg-slate-800/60 border border-slate-700/50"
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            className={`h-6 w-6 transition-colors duration-300 ${isDragOver ? "text-emerald-400" : "text-slate-400"}`}
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
        <div className="flex flex-col gap-1">
          <p className="font-medium text-slate-200">
            {status === "uploading" ? (
              <span className="flex items-center gap-2 justify-center">
                <svg className="h-4 w-4 animate-spin-custom" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v3a5 5 0 0 0-5 5H4Z" />
                </svg>
                {isRetrying ? "Waking the backend…" : "Uploading…"}
              </span>
            ) : (
              "Drop a CSV here, or click to browse"
            )}
          </p>
          <p className="text-sm text-slate-500">Max 10 MB · .csv only</p>
        </div>
      </div>

      {error && (
        <div className="error-card flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm animate-fadeIn">
          <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.63-1.516 2.63H3.72c-1.347 0-2.189-1.463-1.515-2.63L8.485 2.495ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
              clipRule="evenodd"
            />
          </svg>
          {error}
        </div>
      )}

      {report && (
        <div className="animate-fadeInUp">
          <QualityReportView report={report} />
        </div>
      )}
      {report?.eda && (
        <div className="animate-fadeInUp delay-100">
          <EdaView eda={report.eda} />
        </div>
      )}
      {report && report.columns.length >= 2 && (
        <div className="animate-fadeInUp delay-200">
          <StatsTestPanel key={`tests-${report.id}`} datasetId={report.id} columns={report.columns} />
        </div>
      )}
      {report && (
        <div className="animate-fadeInUp delay-300">
          <ModelPanel key={`model-${report.id}`} datasetId={report.id} columns={report.columns} eda={report.eda ?? null} />
        </div>
      )}
      {report && (
        <div className="animate-fadeInUp delay-400">
          <ReportExportButton key={`export-${report.id}`} datasetId={report.id} filename={report.original_filename} />
        </div>
      )}
    </div>
  );
}
