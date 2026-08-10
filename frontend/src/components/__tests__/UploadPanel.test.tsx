import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UploadPanel } from "@/components/UploadPanel";
import type { QualityReport } from "@/lib/types";

function buildReport(overrides: Partial<QualityReport> = {}): QualityReport {
  return {
    id: "d1",
    original_filename: "sample.csv",
    row_count: 18,
    column_count: 2,
    file_size_bytes: 421,
    duplicate_row_count: 0,
    upload_time: "2026-08-10T12:00:00Z",
    columns: [
      { column_name: "age", data_type: "numeric", missing_count: 0, missing_pct: 0, unique_count: 18, outlier_count: 0, summary_stats: { mean: 32, median: 30, std: 5, min: 22, max: 50 } },
      { column_name: "city", data_type: "categorical", missing_count: 0, missing_pct: 0, unique_count: 4, outlier_count: null, summary_stats: { top_value: "Lahore", top_frequency: 6 } },
    ],
    eda: {
      numeric_distributions: [{ column_name: "age", bins: [{ bin_start: 20, bin_end: 30, count: 5 }] }],
      categorical_frequencies: [{ column_name: "city", categories: [{ value: "Lahore", count: 6 }] }],
      correlation_matrix: null,
    },
    ...overrides,
  };
}

function getFileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!input) throw new Error("file input not found");
  return input as HTMLInputElement;
}

function fileOfSize(name: string, bytes: number, type = "text/csv"): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: bytes });
  return file;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:8000");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("UploadPanel", () => {
  it("rejects a non-CSV file client-side without calling fetch", async () => {
    // userEvent.upload() respects the input's accept=".csv" attribute and
    // silently filters out non-matching files (emulating a real file picker),
    // which would never exercise the component's own validation — use
    // fireEvent instead, which sets the file list directly.
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<UploadPanel />);

    fireEvent.change(getFileInput(), { target: { files: [new File(["x"], "data.txt", { type: "text/plain" })] } });

    await waitFor(() => expect(screen.getByText("Only .csv files are accepted.")).toBeInTheDocument());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an oversized file client-side without calling fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const user = userEvent.setup();
    render(<UploadPanel />);

    await user.upload(getFileInput(), fileOfSize("big.csv", 10 * 1024 * 1024 + 1));

    expect(screen.getByText("File exceeds the 10MB upload limit.")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uploads a valid CSV and renders the quality report, EDA, and downstream panels", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json: async () => buildReport() }));
    const user = userEvent.setup();
    render(<UploadPanel />);

    await user.upload(getFileInput(), fileOfSize("sample.csv", 421));

    await waitFor(() => expect(screen.getByText("sample.csv")).toBeInTheDocument());
    expect(screen.getByText("Exploratory Data Analysis")).toBeInTheDocument();
    expect(screen.getByText("Statistical Testing")).toBeInTheDocument();
    expect(screen.getByText("Baseline Model")).toBeInTheDocument();
    expect(screen.getByText("Export")).toBeInTheDocument();

    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("http://localhost:8000/api/datasets/upload");
    expect((options as RequestInit).credentials).toBe("include");
    expect((options as RequestInit).body).toBeInstanceOf(FormData);
  });

  it("does not render StatsTestPanel for a single-column dataset", async () => {
    const oneColumnReport = buildReport({
      column_count: 1,
      columns: [buildReport().columns[0]],
      eda: { numeric_distributions: [], categorical_frequencies: [], correlation_matrix: null },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json: async () => oneColumnReport }));
    const user = userEvent.setup();
    render(<UploadPanel />);

    await user.upload(getFileInput(), fileOfSize("sample.csv", 421));

    await waitFor(() => expect(screen.getByText("sample.csv")).toBeInTheDocument());
    expect(screen.queryByText("Statistical Testing")).not.toBeInTheDocument();
    // ModelPanel and Export still apply — a single numeric column is still a valid model target.
    expect(screen.getByText("Baseline Model")).toBeInTheDocument();
  });

  it("shows the server's error message on a non-ok upload response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({ ok: false, json: async () => ({ error: { code: "malformed_csv", message: "Could not parse CSV." } }) }),
    );
    const user = userEvent.setup();
    render(<UploadPanel />);

    await user.upload(getFileInput(), fileOfSize("bad.csv", 10));

    await waitFor(() => expect(screen.getByText("Could not parse CSV.")).toBeInTheDocument());
    expect(screen.queryByText("Exploratory Data Analysis")).not.toBeInTheDocument();
  });

  it("shows a generic error when the network request throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("down")));
    const user = userEvent.setup();
    render(<UploadPanel />);

    await user.upload(getFileInput(), fileOfSize("sample.csv", 10));

    await waitFor(() => expect(screen.getByText("Could not reach the backend. Please try again.")).toBeInTheDocument());
  });

  it("clears the previous report and error when a new upload starts", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, json: async () => ({ error: { code: "malformed_csv", message: "Bad file." } }) })
        .mockResolvedValueOnce({ ok: true, json: async () => buildReport({ original_filename: "second.csv" }) }),
    );
    const user = userEvent.setup();
    render(<UploadPanel />);

    await user.upload(getFileInput(), fileOfSize("bad.csv", 10));
    await waitFor(() => expect(screen.getByText("Bad file.")).toBeInTheDocument());

    await user.upload(getFileInput(), fileOfSize("second.csv", 10));
    await waitFor(() => expect(screen.getByText("second.csv")).toBeInTheDocument());
    expect(screen.queryByText("Bad file.")).not.toBeInTheDocument();
  });
});
