import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StatsTestPanel } from "@/components/StatsTestPanel";
import type { ColumnProfile } from "@/lib/types";

const columns: ColumnProfile[] = [
  { column_name: "age", data_type: "numeric", missing_count: 0, missing_pct: 0, unique_count: 5, outlier_count: 0, summary_stats: null },
  { column_name: "city", data_type: "categorical", missing_count: 0, missing_pct: 0, unique_count: 3, outlier_count: null, summary_stats: null },
];

// status and text() round out the mock to the parts of a real Response the api
// client reads — it parses a failed response's body via text(), so that a
// non-JSON error page can be told apart from an unreachable backend.
function mockFetchOnce(response: { ok: boolean; json: () => Promise<unknown> }) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValueOnce({
      status: response.ok ? 200 : 400,
      text: async () => JSON.stringify(await response.json()),
      ...response,
    }),
  );
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:8000");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("StatsTestPanel", () => {
  it("defaults Column A/B to the first two columns", () => {
    render(<StatsTestPanel datasetId="d1" columns={columns} />);
    expect(screen.getByLabelText("Column A")).toHaveValue("age");
    expect(screen.getByLabelText("Column B")).toHaveValue("city");
  });

  it("shows an error and does not call fetch when both columns match", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const user = userEvent.setup();
    render(<StatsTestPanel datasetId="d1" columns={columns} />);

    await user.selectOptions(screen.getByLabelText("Column B"), "age");
    await user.click(screen.getByRole("button", { name: "Run Test" }));

    expect(screen.getByText("Choose two different columns to run a test.")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts to /tests and renders the returned result", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        id: "t1",
        dataset_id: "d1",
        test_type: "anova",
        column_a: "age",
        column_b: "city",
        statistic: 9.4196,
        p_value: 0.0012,
        conclusion: "There is a statistically significant difference in 'age' across the 4 groups of 'city'.",
        created_at: "2026-08-10T12:00:00Z",
      }),
    });
    const user = userEvent.setup();
    render(<StatsTestPanel datasetId="d1" columns={columns} />);

    await user.click(screen.getByRole("button", { name: "Run Test" }));

    await waitFor(() => expect(screen.getByText("ANOVA")).toBeInTheDocument());
    expect(screen.getByText("9.4196")).toBeInTheDocument();
    expect(screen.getByText("0.0012")).toBeInTheDocument();
    expect(
      screen.getByText("There is a statistically significant difference in 'age' across the 4 groups of 'city'."),
    ).toBeInTheDocument();

    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("http://localhost:8000/api/datasets/d1/tests");
    expect(JSON.parse((options as RequestInit).body as string)).toEqual({ column_a: "age", column_b: "city" });
  });

  it("shows the server's error message on a non-ok response", async () => {
    mockFetchOnce({
      ok: false,
      json: async () => ({ error: { code: "unsupported_test_pairing", message: "Two numeric columns aren't supported." } }),
    });
    const user = userEvent.setup();
    render(<StatsTestPanel datasetId="d1" columns={columns} />);

    await user.click(screen.getByRole("button", { name: "Run Test" }));

    await waitFor(() => expect(screen.getByText("Two numeric columns aren't supported.")).toBeInTheDocument());
  });

  it("shows a generic error when the network request throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const user = userEvent.setup();
    render(<StatsTestPanel datasetId="d1" columns={columns} />);

    await user.click(screen.getByRole("button", { name: "Run Test" }));

    await waitFor(() => expect(screen.getByText("Could not reach the backend. Check your connection and try again.")).toBeInTheDocument());
  });

  it("prepends new results so the newest run shows first", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        id: "t1",
        dataset_id: "d1",
        test_type: "t_test",
        column_a: "age",
        column_b: "city",
        statistic: 1,
        p_value: 0.5,
        conclusion: "first",
        created_at: "2026-01-01T00:00:00Z",
      }),
    });
    const user = userEvent.setup();
    render(<StatsTestPanel datasetId="d1" columns={columns} />);
    await user.click(screen.getByRole("button", { name: "Run Test" }));
    await waitFor(() => expect(screen.getByText("first")).toBeInTheDocument());

    mockFetchOnce({
      ok: true,
      json: async () => ({
        id: "t2",
        dataset_id: "d1",
        test_type: "chi_square",
        column_a: "age",
        column_b: "city",
        statistic: 2,
        p_value: 0.2,
        conclusion: "second",
        created_at: "2026-01-02T00:00:00Z",
      }),
    });
    await user.click(screen.getByRole("button", { name: "Run Test" }));
    await waitFor(() => expect(screen.getByText("second")).toBeInTheDocument());

    const conclusions = screen.getAllByText(/^(first|second)$/).map((el) => el.textContent);
    expect(conclusions).toEqual(["second", "first"]);
  });
});
