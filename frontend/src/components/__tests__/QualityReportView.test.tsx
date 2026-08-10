import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QualityReportView } from "@/components/QualityReportView";
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
      {
        column_name: "age",
        data_type: "numeric",
        missing_count: 0,
        missing_pct: 0,
        unique_count: 18,
        outlier_count: 0,
        summary_stats: { mean: 32.28, median: 30.5, std: 8, min: 22, max: 50 },
      },
      {
        column_name: "city",
        data_type: "categorical",
        missing_count: 1,
        missing_pct: 5.56,
        unique_count: 4,
        outlier_count: null,
        summary_stats: { top_value: "Lahore", top_frequency: 6 },
      },
    ],
    ...overrides,
  };
}

describe("QualityReportView", () => {
  it("renders the filename and file size", () => {
    render(<QualityReportView report={buildReport()} />);
    expect(screen.getByText("sample.csv")).toBeInTheDocument();
    expect(screen.getByText("421 B")).toBeInTheDocument();
  });

  it("renders row/column/duplicate/missing-cell stats", () => {
    render(<QualityReportView report={buildReport()} />);
    // "Rows"/"Columns"/etc. dt-dd pairs — scope past the column table, which
    // can repeat the same numbers (e.g. the age column's own "18" unique count).
    expect(screen.getByText("Rows").nextElementSibling).toHaveTextContent("18");
    expect(screen.getByText("Columns").nextElementSibling).toHaveTextContent("2");
    expect(screen.getByText("Missing cells").nextElementSibling).toHaveTextContent("1");
  });

  it("flags duplicate rows and missing cells as warnings when present", () => {
    render(<QualityReportView report={buildReport({ duplicate_row_count: 3 })} />);
    const dupValue = screen.getByText("3");
    expect(dupValue.className).toContain("text-amber-400");
  });

  it("renders a numeric column's summary as mean/median/range", () => {
    render(<QualityReportView report={buildReport()} />);
    expect(screen.getByText(/mean 32\.28 · median 30\.5 · range 22–50/)).toBeInTheDocument();
  });

  it("renders a categorical column's summary as top value + frequency", () => {
    render(<QualityReportView report={buildReport()} />);
    expect(screen.getByText(/top: "Lahore" \(×6\)/)).toBeInTheDocument();
  });

  it("shows a dash for missing summary stats", () => {
    const report = buildReport({
      columns: [
        {
          column_name: "notes",
          data_type: "text",
          missing_count: 0,
          missing_pct: 0,
          unique_count: 0,
          outlier_count: null,
          summary_stats: null,
        },
      ],
    });
    render(<QualityReportView report={report} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders every column name as a row", () => {
    render(<QualityReportView report={buildReport()} />);
    expect(screen.getByText("age")).toBeInTheDocument();
    expect(screen.getByText("city")).toBeInTheDocument();
  });
});
