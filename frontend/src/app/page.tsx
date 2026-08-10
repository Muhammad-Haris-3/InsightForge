"use client";

import { useEffect, useState } from "react";
import { UploadPanel } from "@/components/UploadPanel";

type ApiStatus = "checking" | "ok" | "unreachable";

function LogoMark() {
  return (
    <svg viewBox="0 0 32 32" className="h-10 w-10" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="logoGrad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#2dd4bf" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#logoGrad)" />
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
      ? "bg-emerald-400"
      : status === "unreachable"
        ? "bg-red-400"
        : "bg-slate-400 animate-pulse";
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
    <div className="hero-glow flex flex-1 flex-col items-center gap-12 px-6 py-20 sm:py-28">
      <div className="flex flex-col items-center gap-6 text-center animate-fadeInUp">
        <div className="flex items-center gap-3 animate-float">
          <LogoMark />
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl gradient-text">
            InsightForge
          </h1>
        </div>
        <p className="max-w-xl text-balance text-base text-slate-400 sm:text-lg leading-relaxed">
          Upload a CSV. Get an automated data-quality audit, exploratory analysis, statistical testing, and a
          baseline model with plain-language results — no code required.
        </p>
        <div className="glass flex items-center gap-2 rounded-full px-4 py-1.5 text-xs text-slate-400 animate-fadeIn delay-300">
          <StatusDot status={apiStatus} />
          <span>Backend API: {apiStatus}</span>
        </div>
      </div>

      <UploadPanel />
    </div>
  );
}
