import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  // --- Sticky axes: on a wide matrix, scrolling sideways used to carry the column
  // names out of view, leaving anonymous numbers with nothing to read them against.

  it("pins the column headers to the top of the scroll container", () => {
    render(<EdaView eda={buildEda()} />);

    for (const name of ["age", "salary"]) {
      const header = screen.getByRole("columnheader", { name });
      expect(header.className).toContain("sticky");
      expect(header.className).toContain("top-0");
    }
  });

  it("pins the row labels to the left of the scroll container", () => {
    render(<EdaView eda={buildEda()} />);

    for (const name of ["age", "salary"]) {
      const label = screen.getByRole("rowheader", { name });
      expect(label.className).toContain("sticky");
      expect(label.className).toContain("left-0");
    }
  });

  it("gives each correlation cell a title naming both of its columns", () => {
    render(<EdaView eda={buildEda()} />);

    // Without a persistent label a cell is just a number — the title spells out
    // which pair it belongs to, matching what the pinned axes show.
    expect(screen.getByTitle("age vs salary: 0.45")).toBeInTheDocument();
    expect(screen.getByTitle("salary vs age: 0.45")).toBeInTheDocument();
  });

  // --- Chart capping: a wide CSV rendered one chart per column, and ~220k DOM
  // nodes made the page unresponsive. The cap is what keeps a wide dataset usable.

  function manyNumeric(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      column_name: `col_${i}`,
      bins: [{ bin_start: 0, bin_end: 10, count: 5 }],
    }));
  }

  it("renders every chart when the dataset is narrow", () => {
    render(<EdaView eda={buildEda({ numeric_distributions: manyNumeric(4), categorical_frequencies: [] })} />);

    expect(screen.getAllByRole("heading", { level: 4 })).toHaveLength(4);
    expect(screen.queryByRole("button", { name: /Show all/ })).not.toBeInTheDocument();
  });

  it("caps the charts rendered up front on a wide dataset", () => {
    render(<EdaView eda={buildEda({ numeric_distributions: manyNumeric(50), categorical_frequencies: [] })} />);

    expect(screen.getAllByRole("heading", { level: 4 })).toHaveLength(12);
    expect(screen.getByRole("button", { name: "Show all 50 charts (38 more)" })).toBeInTheDocument();
  });

  it("reveals the rest on request, so nothing is hidden permanently", async () => {
    const user = userEvent.setup();
    render(<EdaView eda={buildEda({ numeric_distributions: manyNumeric(50), categorical_frequencies: [] })} />);

    await user.click(screen.getByRole("button", { name: "Show all 50 charts (38 more)" }));

    expect(screen.getAllByRole("heading", { level: 4 })).toHaveLength(50);
    expect(screen.getByRole("button", { name: "Show fewer" })).toBeInTheDocument();
  });

  it("shows the column count so a wide dataset is not mistaken for a short one", () => {
    render(<EdaView eda={buildEda({ numeric_distributions: manyNumeric(50), categorical_frequencies: [] })} />);

    expect(screen.getByText("(50 columns)")).toBeInTheDocument();
  });

  it("renders a wide correlation matrix only on request", async () => {
    // 90,000 cells is ~180,000 DOM nodes on its own — enough to stall the page.
    const columns = Array.from({ length: 60 }, (_, i) => `c_${i}`);
    const eda = buildEda({
      correlation_matrix: { columns, matrix: columns.map(() => columns.map(() => 0.5)) },
    });
    const user = userEvent.setup();
    render(<EdaView eda={eda} />);

    expect(screen.queryByRole("rowheader", { name: "c_0" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Render 60 × 60 matrix/ }));

    expect(screen.getByRole("rowheader", { name: "c_0" })).toBeInTheDocument();
  });

  it("renders a normal-width correlation matrix immediately", () => {
    render(<EdaView eda={buildEda()} />);

    expect(screen.getByRole("rowheader", { name: "age" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Render .* matrix/ })).not.toBeInTheDocument();
  });

  it("scrolls the matrix inside its own container rather than the page", () => {
    const { container } = render(<EdaView eda={buildEda()} />);

    const scroller = container.querySelector(".corr-scroll");
    expect(scroller).not.toBeNull();
    expect(scroller?.className).toContain("overflow-auto");
  });
});
