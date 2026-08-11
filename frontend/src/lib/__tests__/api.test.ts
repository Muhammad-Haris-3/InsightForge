import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "@/lib/api";

/**
 * The bug these cover: the deployed backend runs on Render's free tier, which
 * spins the instance down when idle. While it boots, Render's own router answers
 * with an HTML 502 — not the backend's JSON error envelope. The old call sites did
 * `await res.json()` on that HTML, which threw, hit their outer catch, and got
 * reported as "Could not reach the backend. Please try again." — a connectivity
 * message for something that was neither a connectivity problem nor permanent.
 */

const HTML_502 =
  "<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>Bad gateway</body></html>";

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

function htmlResponse(status: number, html: string) {
  return { ok: false, status, text: async () => html };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:8000");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("apiFetch", () => {
  it("returns the response on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { ok: true })));

    const res = await apiFetch("/health");

    expect(res.status).toBe(200);
  });

  it("sends credentials so the session cookie rides along", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/health");

    expect(fetchMock.mock.calls[0][1].credentials).toBe("include");
  });

  it("joins the base URL and path without a doubled slash", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:8000/");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/health");

    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8000/health");
  });

  it("surfaces the backend's own error message and does not retry it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(400, { error: { code: "malformed_csv", message: "Could not parse CSV." } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("/api/datasets/upload")).rejects.toThrow("Could not parse CSV.");
    // A real, explained rejection — retrying it would just fail identically.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a cold-start 502 and succeeds once the instance is awake", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse(502, HTML_502))
      .mockResolvedValueOnce(jsonResponse(200, { status: "ok" }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await apiFetch("/health");

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports a persistent 502 as the backend waking, not as an unreachable backend", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(htmlResponse(502, HTML_502)));

    const error = await apiFetch("/health").catch((e: unknown) => e as ApiError);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe("waking");
    expect((error as ApiError).message).toContain("starting up");
    // The precise regression: HTML in the error body must not be read as a dead connection.
    expect((error as ApiError).message).not.toContain("Could not reach the backend");
  });

  it("notifies the caller before each retry so the UI can say it is waking", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(htmlResponse(503, "<html>no upstream</html>")));
    const onRetry = vi.fn();

    await apiFetch("/health", { onRetry }).catch(() => {});

    expect(onRetry).toHaveBeenCalled();
  });

  it("reports a rejected fetch as a connectivity problem", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const error = await apiFetch("/health").catch((e: unknown) => e as ApiError);

    expect((error as ApiError).kind).toBe("offline");
    expect((error as ApiError).message).toContain("Check your connection");
  });

  it("makes a single attempt when retries are disabled", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/health", { retries: 0 }).catch(() => {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a non-cold-start error that came back without a JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(htmlResponse(404, "<html>not found</html>"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("/api/datasets/x")).rejects.toThrow(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops immediately when the caller aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("/health", { signal: controller.signal })).rejects.toThrow("cancelled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails clearly when the backend URL is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");

    const error = await apiFetch("/health").catch((e: unknown) => e as ApiError);

    expect((error as ApiError).kind).toBe("config");
  });
});
