import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModelPanel } from "@/components/ModelPanel";
import type { ColumnProfile } from "@/lib/types";

const columns: ColumnProfile[] = [
  { column_name: "age", data_type: "numeric", missing_count: 0, missing_pct: 0, unique_count: 20, outlier_count: 0, summary_stats: { mean: 30, median: 29, std: 5, min: 20, max: 50 } },
  { column_name: "city", data_type: "categorical", missing_count: 0, missing_pct: 0, unique_count: 3, outlier_count: null, summary_stats: { top_value: "Lahore", top_frequency: 6 } },
  { column_name: "notes", data_type: "text", missing_count: 0, missing_pct: 0, unique_count: 40, outlier_count: null, summary_stats: null },
];

// Mirrors the parts of a real Response the api client touches. It reads the error
// body with text() + JSON.parse rather than json(), so that a non-JSON body (the
// HTML error page Render's router serves during a cold start) is recognised as
// "the proxy answered" instead of being mistaken for a dead connection.
function mockJsonResponse(ok: boolean, body: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:8000");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("ModelPanel", () => {
  it("renders nothing when no column is numeric/categorical/boolean", () => {
    const { container } = render(
      <ModelPanel
        datasetId="d1"
        columns={[{ column_name: "notes", data_type: "text", missing_count: 0, missing_pct: 0, unique_count: 1, outlier_count: null, summary_stats: null }]}
        eda={null}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("defaults the target column to the first eligible (numeric/categorical/boolean) column", () => {
    render(<ModelPanel datasetId="d1" columns={columns} eda={null} />);
    expect(screen.getByLabelText("Target column")).toHaveValue("age");
  });

  it("excludes text columns from the target dropdown", () => {
    render(<ModelPanel datasetId="d1" columns={columns} eda={null} />);
    const select = screen.getByLabelText("Target column") as HTMLSelectElement;
    const optionValues = [...select.options].map((o) => o.value);
    expect(optionValues).toEqual(["age", "city"]);
  });

  it("trains a model and renders its metrics, target, and feature-importance summary", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          mockJsonResponse(true, {
            id: "run1",
            dataset_id: "d1",
            target_column: "age",
            model_type: "regression",
            algorithm: "random_forest",
            metrics: { r2: 0.87, mae: 1.5, rmse: 2.1 },
            feature_importance: { city: 1.0 },
            feature_importance_summary: "The strongest predictors of 'age' are 'city' (100%).",
            created_at: "2026-08-10T12:00:00Z",
          }),
        )
        // PredictSimulator fires its own debounced predict call on mount.
        .mockResolvedValueOnce(mockJsonResponse(true, { prediction: 31.2, probabilities: null })),
    );
    const user = userEvent.setup();
    render(<ModelPanel datasetId="d1" columns={columns} eda={null} />);

    await user.click(screen.getByRole("button", { name: "Train Model" }));

    await waitFor(() => expect(screen.getByText("Regression")).toBeInTheDocument());
    expect(screen.getByText("target: age")).toBeInTheDocument();
    expect(screen.getByText("R²")).toBeInTheDocument();
    expect(screen.getByText("0.8700")).toBeInTheDocument();
    expect(screen.getByText("The strongest predictors of 'age' are 'city' (100%).")).toBeInTheDocument();

    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("http://localhost:8000/api/datasets/d1/model");
    expect(JSON.parse((options as RequestInit).body as string)).toEqual({ target_column: "age" });
  }, 10000);

  it("shows the server's error message on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(mockJsonResponse(false, { error: { code: "insufficient_data", message: "Not enough rows." } })),
    );
    const user = userEvent.setup();
    render(<ModelPanel datasetId="d1" columns={columns} eda={null} />);

    await user.click(screen.getByRole("button", { name: "Train Model" }));

    await waitFor(() => expect(screen.getByText("Not enough rows.")).toBeInTheDocument());
  });

  it("shows a generic error when the network request throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    const user = userEvent.setup();
    render(<ModelPanel datasetId="d1" columns={columns} eda={null} />);

    await user.click(screen.getByRole("button", { name: "Train Model" }));

    await waitFor(() => expect(screen.getByText("Could not reach the backend. Check your connection and try again.")).toBeInTheDocument());
  });
});
