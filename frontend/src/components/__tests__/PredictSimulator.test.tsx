import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PredictSimulator } from "@/components/PredictSimulator";
import type { ColumnProfile, EdaReport, ModelRun } from "@/lib/types";

const WAIT_OPTS = { timeout: 2000 };

const columns: ColumnProfile[] = [
  { column_name: "age", data_type: "numeric", missing_count: 0, missing_pct: 0, unique_count: 20, outlier_count: 0, summary_stats: { mean: 30, median: 29, std: 5, min: 20, max: 50 } },
  { column_name: "city", data_type: "categorical", missing_count: 0, missing_pct: 0, unique_count: 3, outlier_count: null, summary_stats: { top_value: "Lahore", top_frequency: 6 } },
];

const eda: EdaReport = {
  numeric_distributions: [],
  categorical_frequencies: [
    { column_name: "city", categories: [{ value: "Lahore", count: 6 }, { value: "Karachi", count: 4 }] },
  ],
  correlation_matrix: null,
};

function regressionRun(overrides: Partial<ModelRun> = {}): ModelRun {
  return {
    id: "run1",
    dataset_id: "d1",
    target_column: "score",
    model_type: "regression",
    algorithm: "random_forest",
    metrics: { r2: 0.9 },
    feature_importance: { age: 0.7, city: 0.3 },
    feature_importance_summary: "x",
    created_at: "2026-08-10T12:00:00Z",
    ...overrides,
  };
}

function mockJsonResponse(ok: boolean, body: unknown) {
  return { ok, json: async () => body };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:8000");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("PredictSimulator", () => {
  it("renders nothing when the run has no feature importance", () => {
    const { container } = render(
      <PredictSimulator datasetId="d1" run={regressionRun({ feature_importance: null })} columns={columns} eda={eda} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("defaults a numeric feature's slider to the column's mean and a categorical feature to its top value", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockJsonResponse(true, { prediction: 1, probabilities: null })));
    render(<PredictSimulator datasetId="d1" run={regressionRun()} columns={columns} eda={eda} />);

    expect(screen.getByRole("slider")).toHaveValue("30");
    expect(screen.getByLabelText("city")).toHaveValue("Lahore");
  });

  it("populates the categorical dropdown from the EDA category frequencies", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockJsonResponse(true, { prediction: 1, probabilities: null })));
    render(<PredictSimulator datasetId="d1" run={regressionRun()} columns={columns} eda={eda} />);

    const select = screen.getByLabelText("city") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["Lahore", "Karachi"]);
  });

  it("fires a debounced prediction on mount and renders the numeric result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockJsonResponse(true, { prediction: 34079.86, probabilities: null })));
    render(<PredictSimulator datasetId="d1" run={regressionRun()} columns={columns} eda={eda} />);

    await waitFor(() => expect(screen.getByText("Predicted score")).toBeInTheDocument(), WAIT_OPTS);
    expect(screen.getByText("34,079.86")).toBeInTheDocument();

    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("http://localhost:8000/api/datasets/d1/model/run1/predict");
    expect(JSON.parse((options as RequestInit).body as string)).toEqual({ features: { age: 30, city: "Lahore" } });
  }, 10000);

  it("re-predicts after a slider change, sending the updated value", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse(true, { prediction: 1, probabilities: null }));
    vi.stubGlobal("fetch", fetchMock);
    render(<PredictSimulator datasetId="d1" run={regressionRun()} columns={columns} eda={eda} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), WAIT_OPTS);

    fireEvent.change(screen.getByRole("slider"), { target: { value: "50" } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), WAIT_OPTS);
    const [, options] = fetchMock.mock.calls[1];
    expect(JSON.parse((options as RequestInit).body as string)).toEqual({ features: { age: 50, city: "Lahore" } });
  }, 10000);

  it("shows a capitalized class label and probabilities for a classification run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockJsonResponse(true, { prediction: "lahore", probabilities: { lahore: 0.6, karachi: 0.4 } })),
    );
    render(<PredictSimulator datasetId="d1" run={regressionRun({ target_column: "city" })} columns={columns} eda={eda} />);

    await waitFor(() => expect(screen.getByText("Lahore", { selector: "span.font-bold" })).toBeInTheDocument(), WAIT_OPTS);
    expect(screen.getByText("Lahore 60%")).toBeInTheDocument();
    expect(screen.getByText("Karachi 40%")).toBeInTheDocument();
  }, 10000);

  it("shows the server's error message on a non-ok prediction response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockJsonResponse(false, { error: { code: "insufficient_data", message: "Not enough data." } })),
    );
    render(<PredictSimulator datasetId="d1" run={regressionRun()} columns={columns} eda={eda} />);

    await waitFor(() => expect(screen.getByText("Not enough data.")).toBeInTheDocument(), WAIT_OPTS);
  }, 10000);

  it("shows a generic error when the network request throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    render(<PredictSimulator datasetId="d1" run={regressionRun()} columns={columns} eda={eda} />);

    await waitFor(
      () => expect(screen.getByText("Could not reach the backend. Please try again.")).toBeInTheDocument(),
      WAIT_OPTS,
    );
  }, 10000);
});
