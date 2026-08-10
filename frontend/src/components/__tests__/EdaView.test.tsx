import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EdaView } from "@/components/EdaView";
import type { EdaReport } from "@/lib/types";

function buildEda(overrides: Partial<EdaReport> = {}): EdaReport {
  return {
    numeric_distributions: [
      {
        column_name: "age",
        bins: [
          { bin_start: 20, bin_end: 30, count: 5 },
          { bin_start: 30, bin_end: 40, count: 8 },
        ],
      },
    ],
    categorical_frequencies: [
      {
        column_name: "city",
        categories: [
          { value: "Lahore", count: 6 },
          { value: "Karachi", count: 4 },
        ],
      },
    ],
    correlation_matrix: {
      columns: ["age", "salary"],
      matrix: [
        [1, 0.45],
        [0.45, 1],
      ],
    },
    ...overrides,
  };
}

describe("EdaView", () => {
  it("renders nothing when there are no numeric or categorical columns", () => {
    const { container } = render(
      <EdaView eda={{ numeric_distributions: [], categorical_frequencies: [], correlation_matrix: null }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the Distributions section with each numeric column's name", () => {
    render(<EdaView eda={buildEda()} />);
    expect(screen.getByText("Distributions")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "age", level: 4 })).toBeInTheDocument();
  });

  it("renders the Category Frequencies section with each categorical column's name", () => {
    render(<EdaView eda={buildEda()} />);
    expect(screen.getByText("Category Frequencies")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "city", level: 4 })).toBeInTheDocument();
  });

  it("omits the Distributions section when there are no numeric columns", () => {
    render(<EdaView eda={buildEda({ numeric_distributions: [] })} />);
    expect(screen.queryByText("Distributions")).not.toBeInTheDocument();
  });

  it("omits the Category Frequencies section when there are no categorical columns", () => {
    render(<EdaView eda={buildEda({ categorical_frequencies: [] })} />);
    expect(screen.queryByText("Category Frequencies")).not.toBeInTheDocument();
  });

  it("renders the correlation matrix with formatted values", () => {
    render(<EdaView eda={buildEda()} />);
    expect(screen.getByText("Correlation Matrix")).toBeInTheDocument();
    expect(screen.getAllByText("1.00")).toHaveLength(2); // diagonal
    expect(screen.getAllByText("0.45")).toHaveLength(2); // symmetric off-diagonal
  });

  it("renders an em dash for a null correlation cell", () => {
    const eda = buildEda({
      correlation_matrix: {
        columns: ["age", "salary"],
        matrix: [
          [1, null],
          [null, 1],
        ],
      },
    });
    render(<EdaView eda={eda} />);
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("omits the Correlation Matrix section when there are fewer than 2 numeric columns", () => {
    render(<EdaView eda={buildEda({ correlation_matrix: null })} />);
    expect(screen.queryByText("Correlation Matrix")).not.toBeInTheDocument();
  });
});
