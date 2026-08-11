"use client";

import { useEffect, useState } from "react";
import { UploadPanel } from "@/components/UploadPanel";
import { apiFetch } from "@/lib/api";

type ApiStatus = "checking" | "waking" | "ok" | "unreachable";

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

const STATUS_LABELS: Record<ApiStatus, string> = {
  checking: "checking",
  waking: "waking up (free tier cold start, ~1 min)",
  ok: "ok",
  unreachable: "unreachable",
};

function StatusDot({ status }: { status: ApiStatus }) {
  const color =
    status === "ok"
      ? "bg-emerald-400"
      : status === "unreachable"
        ? "bg-red-400"
        : status === "waking"
          ? "bg-amber-400 animate-pulse"
          : "bg-slate-400 animate-pulse";
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${color}`} />;
}

export default function Home() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");

  useEffect(() => {
    const controller = new AbortController();

    // This ping doubles as the wake-up call for the backend: it runs on the free
    // Render tier, which spins the instance down after ~15 minutes idle. Firing it
    // (with retries) as soon as the page loads means the instance is usually warm
    // by the time someone actually drops a CSV in — and the badge reports "waking"
    // through the cold start instead of latching to "unreachable" on the first miss.
    apiFetch("/health", {
      signal: controller.signal,
      onRetry: () => setApiStatus("waking"),
    })
      .then(() => setApiStatus("ok"))
      .catch(() => {
        if (!controller.signal.aborted) setApiStatus("unreachable");
      });

    return () => controller.abort();
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
          <span>Backend API: {STATUS_LABELS[apiStatus]}</span>
        </div>
      </div>

      <UploadPanel />
    </div>
  );
}
