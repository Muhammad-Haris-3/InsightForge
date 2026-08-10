import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportExportButton } from "@/components/ReportExportButton";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:8000");
  // jsdom doesn't implement these — assign them directly rather than via
  // vi.stubGlobal, which would replace the whole URL constructor.
  URL.createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("ReportExportButton", () => {
  it("fetches the PDF with credentials and triggers a download on success", async () => {
    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === "a") el.click = clickSpy;
      return el;
    });

    const blob = new Blob(["%PDF-"], { type: "application/pdf" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, blob: async () => blob }));

    const user = userEvent.setup();
    render(<ReportExportButton datasetId="d1" filename="sales report (final).csv" />);
    await user.click(screen.getByRole("button", { name: "Download PDF Report" }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));

    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("http://localhost:8000/api/datasets/d1/report/pdf");
    expect((options as RequestInit).credentials).toBe("include");
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");

    // Spaces are preserved by the sanitizer (allowed in its character class);
    // only "(" and ")" get replaced with "_".
    const anchorCall = createElementSpy.mock.results.find((r) => (r.value as HTMLElement).tagName === "A");
    expect((anchorCall?.value as HTMLAnchorElement).download).toBe("sales report _final__insightforge_report.pdf");

    createElementSpy.mockRestore();
  });

  it("falls back to a default filename stem when the extension strips the entire name", async () => {
    // ".csv" has no basename before the extension, so the stem is empty —
    // this is the one case that actually triggers the `|| "dataset"`
    // fallback (an all-invalid-character stem like "???" instead becomes
    // "___", which is non-empty and does NOT trigger the fallback).
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, blob: async () => new Blob() }));
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === "a") el.click = vi.fn();
      return el;
    });

    const user = userEvent.setup();
    render(<ReportExportButton datasetId="d1" filename=".csv" />);
    await user.click(screen.getByRole("button", { name: "Download PDF Report" }));

    await waitFor(() => {
      const anchorCall = createElementSpy.mock.results.find((r) => (r.value as HTMLElement).tagName === "A");
      expect((anchorCall?.value as HTMLAnchorElement).download).toBe("dataset_insightforge_report.pdf");
    });

    createElementSpy.mockRestore();
  });

  it("shows the server's error message on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({ ok: false, json: async () => ({ error: { code: "dataset_not_found", message: "No dataset found." } }) }),
    );
    const user = userEvent.setup();
    render(<ReportExportButton datasetId="d1" filename="sample.csv" />);
    await user.click(screen.getByRole("button", { name: "Download PDF Report" }));

    await waitFor(() => expect(screen.getByText("No dataset found.")).toBeInTheDocument());
  });

  it("shows a generic error when the network request throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("down")));
    const user = userEvent.setup();
    render(<ReportExportButton datasetId="d1" filename="sample.csv" />);
    await user.click(screen.getByRole("button", { name: "Download PDF Report" }));

    await waitFor(() => expect(screen.getByText("Could not reach the backend. Please try again.")).toBeInTheDocument());
  });

  it("disables the button while a download is in flight", async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
      ),
    );
    const user = userEvent.setup();
    render(<ReportExportButton datasetId="d1" filename="sample.csv" />);
    const button = screen.getByRole("button", { name: "Download PDF Report" });
    await user.click(button);

    expect(screen.getByRole("button", { name: "Generating PDF…" })).toBeDisabled();

    resolveFetch({ ok: true, blob: async () => new Blob() });
    await waitFor(() => expect(screen.getByRole("button", { name: "Download PDF Report" })).not.toBeDisabled());
  });
});
