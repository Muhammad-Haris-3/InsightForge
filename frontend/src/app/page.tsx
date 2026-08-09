"use client";

import { useEffect, useState } from "react";

type ApiStatus = "checking" | "ok" | "unreachable";

export default function Home() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    fetch(`${apiUrl}/health`)
      .then((res) => setApiStatus(res.ok ? "ok" : "unreachable"))
      .catch(() => setApiStatus("unreachable"));
  }, []);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-zinc-50 px-6 text-center dark:bg-black">
      <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
        InsightForge
      </h1>
      <p className="max-w-md text-zinc-600 dark:text-zinc-400">
        Upload a CSV, get an automated data-quality audit, EDA, statistical
        testing, and a baseline model — no code required.
      </p>
      <p className="text-sm text-zinc-500 dark:text-zinc-500">
        Backend API:{" "}
        <span
          className={
            apiStatus === "ok"
              ? "text-emerald-600 dark:text-emerald-400"
              : apiStatus === "unreachable"
                ? "text-red-600 dark:text-red-400"
                : "text-zinc-500"
          }
        >
          {apiStatus}
        </span>
      </p>
    </div>
  );
}
