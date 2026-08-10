"use client";

import { useEffect, useState } from "react";
import { UploadPanel } from "@/components/UploadPanel";

type ApiStatus = "checking" | "ok" | "unreachable";

function LogoMark() {
  return (
    <svg viewBox="0 0 32 32" className="h-9 w-9" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="9" className="fill-emerald-600 dark:fill-emerald-500" />
      <path
        d="M9 20.5 13.5 12l4 6 3-4.5 3.5 5.5"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatusDot({ status }: { status: ApiStatus }) {
  const color =
    status === "ok"
      ? "bg-emerald-500"
      : status === "unreachable"
        ? "bg-red-500"
        : "bg-zinc-400 animate-pulse";
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${color}`} />;
}

export default function Home() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    fetch(`${apiUrl}/health`)
      .then((res) => setApiStatus(res.ok ? "ok" : "unreachable"))
      .catch(() => setApiStatus("unreachable"));
  }, []);

  return (
    <div className="hero-glow flex flex-1 flex-col items-center gap-10 px-6 py-16 sm:py-20">
      <div className="flex flex-col items-center gap-5 text-center">
        <div className="flex items-center gap-3">
          <LogoMark />
          <h1 className="text-4xl font-semibold tracking-tight text-black sm:text-5xl dark:text-zinc-50">
            InsightForge
          </h1>
        </div>
        <p className="max-w-lg text-balance text-base text-zinc-600 sm:text-lg dark:text-zinc-400">
          Upload a CSV. Get an automated data-quality audit, exploratory analysis, statistical testing, and a
          baseline model with plain-language results — no code required.
        </p>
        <p className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white/60 px-3 py-1 text-xs text-zinc-500 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-500">
          <StatusDot status={apiStatus} />
          Backend API: {apiStatus}
        </p>
      </div>

      <UploadPanel />
    </div>
  );
}
