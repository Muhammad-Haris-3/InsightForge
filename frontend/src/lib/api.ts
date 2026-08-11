import type { ApiErrorBody } from "@/lib/types";

/**
 * Shared backend client.
 *
 * Every panel used to inline its own `fetch` + try/catch, and all of them had the
 * same two defects:
 *
 *  1. `await res.json()` inside the `!res.ok` branch was unguarded. The backend
 *     always answers with `{"error": {...}}` JSON, but the things *in front* of the
 *     backend do not — Render's router serves an HTML page for 502/503/504. Parsing
 *     that HTML threw a SyntaxError, which fell through to the outer `catch` and got
 *     reported as "Could not reach the backend", the message for a network failure.
 *  2. There was no retry and no timeout. The API runs on Render's free tier, which
 *     spins the instance down after ~15 minutes idle; the next request eats a cold
 *     start of roughly a minute. While the instance boots, Render answers with a 502
 *     that carries no CORS headers, so the browser rejects the response outright and
 *     `fetch` throws — indistinguishable, to the old code, from being offline.
 *
 * Together those turned "the free instance is asleep" into "Could not reach the
 * backend. Please try again." So: parse error bodies defensively, retry the
 * failures that are actually cold-start-shaped, and keep the distinct failure
 * modes distinct in what the user is told.
 */

/** Statuses Render's router returns while an instance is asleep or restarting. */
const COLD_START_STATUSES = new Set([502, 503, 504]);

/**
 * Generous on purpose. Two slow paths stack here: a free-tier cold start with
 * pandas/sklearn in the image, and training on a large upload over a shared CPU.
 * At 90s this timeout was itself failing requests the backend went on to answer
 * successfully — the abort looked identical to a broken backend from the UI.
 */
const REQUEST_TIMEOUT_MS = 150_000;

/**
 * Backoff between cold-start retries. Length also decides the attempt count.
 * Zeroed under test so the suite exercises the same number of attempts without
 * spending the real backoff in wall-clock time.
 */
const RETRY_DELAYS_MS =
  process.env.NODE_ENV === "test" ? [0, 0, 0] : [2_000, 5_000, 10_000];

export type ApiErrorKind =
  | "config" // NEXT_PUBLIC_API_URL missing at build time
  | "offline" // fetch rejected — no response reached us
  | "timeout" // we gave up waiting
  | "waking" // cold-start shaped, still failing after every retry
  | "server"; // a real HTTP error, message came from the backend

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;

  constructor(message: string, kind: ApiErrorKind, status = 0) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
  }
}

function baseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) {
    throw new ApiError("The app is misconfigured — the backend URL is not set.", "config");
  }
  return url.replace(/\/+$/, "");
}

/**
 * Pull the backend's own error message out of a failed response.
 *
 * Returns null rather than throwing when the body isn't the JSON envelope we
 * expect — that is the normal case for an error page produced by the proxy in
 * front of the backend, and it must not be mistaken for a network failure.
 */
async function readErrorMessage(res: Response): Promise<string | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    const body = JSON.parse(text) as ApiErrorBody;
    return body?.error?.message ?? null;
  } catch {
    return null;
  }
}

function fallbackMessage(status: number): string {
  if (COLD_START_STATUSES.has(status)) {
    return "The backend is still starting up. It sleeps after a period of inactivity and can take up to a minute to wake. Please try again shortly.";
  }
  if (status === 404) return "That dataset is no longer available — please upload the file again.";
  if (status === 413) return "That file is too large for the backend to accept.";
  if (status >= 500) return `The backend hit an internal error (HTTP ${status}). Please try again.`;
  return `The request failed (HTTP ${status}).`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ApiFetchOptions extends RequestInit {
  /**
   * Called before each retry so a panel can show "waking the backend…" instead of
   * leaving a dead spinner on screen for the length of a cold start.
   */
  onRetry?: (attempt: number, totalAttempts: number) => void;
  /**
   * Retry budget. Defaults to the full backoff schedule. Set to 0 for calls fired
   * repeatedly off user input (the what-if simulator), where a superseded request
   * should die immediately rather than sit in backoff and land out of order.
   */
  retries?: number;
}

/**
 * Fetch a backend path, retrying cold starts. Resolves only with an ok response;
 * every failure path throws an ApiError carrying a message fit to show the user.
 */
export async function apiFetch(path: string, options: ApiFetchOptions = {}): Promise<Response> {
  const { onRetry, retries = RETRY_DELAYS_MS.length, signal: callerSignal, ...init } = options;
  const url = `${baseUrl()}${path}`;
  const totalAttempts = Math.min(retries, RETRY_DELAYS_MS.length) + 1;

  let lastError: ApiError = new ApiError("Could not reach the backend. Please try again.", "offline");

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    if (callerSignal?.aborted) throw new ApiError("The request was cancelled.", "offline");

    if (attempt > 0) {
      onRetry?.(attempt, totalAttempts);
      await sleep(RETRY_DELAYS_MS[attempt - 1]);
    }

    // AbortSignal.timeout would be tidier, but a manual controller keeps this
    // working on the older mobile Safari versions the deployed app actually sees.
    // The caller's own signal is chained in so an unmounting component can cancel
    // a request that is still in flight.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const abortFromCaller = () => controller.abort();
    callerSignal?.addEventListener("abort", abortFromCaller);

    try {
      const res = await fetch(url, { ...init, credentials: "include", signal: controller.signal });

      if (res.ok) return res;

      const message = await readErrorMessage(res);
      if (message !== null) {
        // The backend itself answered and explained why — a validation failure, an
        // unsupported target column, an expired dataset. Never retry these, and
        // never paper over them with a generic connectivity message.
        throw new ApiError(message, "server", res.status);
      }

      // No JSON envelope: this came from the proxy, not the app.
      lastError = new ApiError(
        fallbackMessage(res.status),
        COLD_START_STATUSES.has(res.status) ? "waking" : "server",
        res.status,
      );
      if (!COLD_START_STATUSES.has(res.status)) throw lastError;
    } catch (err) {
      if (err instanceof ApiError) throw err;

      const aborted = err instanceof DOMException && err.name === "AbortError";
      // Aborted by the caller, not by our timeout — the component moved on, so
      // stop here instead of retrying a request nobody is waiting for.
      if (aborted && callerSignal?.aborted) throw new ApiError("The request was cancelled.", "offline");

      lastError = aborted
        ? new ApiError(
            "The backend took too long to respond. It may still be starting up — please try again.",
            "timeout",
          )
        : new ApiError("Could not reach the backend. Check your connection and try again.", "offline");
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    }
  }

  throw lastError;
}

/** Narrow an unknown caught value to a message safe to render in the UI. */
export function toErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  return fallback;
}
