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
    <div className="flex w-full max-w-3xl flex-col gap-6">
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
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
          isDragOver
            ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/20"
            : "border-zinc-300 bg-white hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600"
        }`}
      >
        <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={onFileChange} />
        <p className="font-medium text-black dark:text-zinc-50">
          {status === "uploading" ? "Uploading…" : "Drop a CSV here, or click to browse"}
        </p>
        <p className="text-sm text-zinc-500">Max 10MB · .csv only</p>
      </div>

      {error && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </p>
      )}

      {report && <QualityReportView report={report} />}
      {report?.eda && <EdaView eda={report.eda} />}
      {report && report.columns.length >= 2 && (
        <StatsTestPanel key={`tests-${report.id}`} datasetId={report.id} columns={report.columns} />
      )}
      {report && <ModelPanel key={`model-${report.id}`} datasetId={report.id} columns={report.columns} />}
      {report && (
        <ReportExportButton key={`export-${report.id}`} datasetId={report.id} filename={report.original_filename} />
      )}
    </div>
  );
}
