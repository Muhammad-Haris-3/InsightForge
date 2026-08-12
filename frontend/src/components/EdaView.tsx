"use client";

import { Fragment, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CategoricalFrequency, CorrelationMatrix, EdaReport, NumericDistribution } from "@/lib/types";

// Validated categorical slots (dataviz skill palette.md) — distinct hues per
// chart type rather than eyeballed colors, kept consistent everywhere a chart
// of that kind appears in the app.
const HISTOGRAM_COLOR = "#60a5fa"; // brighter blue for dark bg
const FREQUENCY_COLOR = "#34d399"; // emerald for dark bg
const DIVERGING_POSITIVE = "#60a5fa"; // blue
const DIVERGING_NEGATIVE = "#f87171"; // brighter red for dark bg

// A wide CSV produces one chart per column, and each Recharts chart is hundreds of
// DOM nodes. A 300-column upload rendered 301 charts and ~220,000 nodes, which made
// the page unresponsive — the browser, not the backend, was the wall. Rendering a
// screenful up front and the rest on request keeps a wide dataset usable without
// hiding any of it.
const CHART_PREVIEW_LIMIT = 12;

// The heatmap renders a cell per pair, so its DOM cost is quadratic: 300 numeric
// columns is 90,000 cells and ~180,000 nodes on its own. Past this width it is
// also genuinely unreadable on screen — which is what the paginated blocks in the
// PDF export are for — so it renders on request rather than by default.
const CORRELATION_AUTO_RENDER_LIMIT = 40;

function ChartSection<T>({
  title,
  items,
  keyOf,
  renderItem,
}: {
  title: string;
  items: T[];
  keyOf: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
}) {
  const [showAll, setShowAll] = useState(false);
  const hiddenCount = items.length - CHART_PREVIEW_LIMIT;
  const visible = showAll ? items : items.slice(0, CHART_PREVIEW_LIMIT);

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
        {title}
        {hiddenCount > 0 && <span className="ml-2 normal-case tracking-normal text-slate-600">({items.length} columns)</span>}
      </h3>
      <div className="section-divider" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {visible.map((item) => (
          <Fragment key={keyOf(item)}>{renderItem(item)}</Fragment>
        ))}
      </div>
      {hiddenCount > 0 && (
        <div className="flex flex-col items-start gap-1.5">
          <button
            onClick={() => setShowAll((prev) => !prev)}
            className="btn-secondary rounded-xl px-4 py-2 text-sm font-medium"
          >
            {showAll ? "Show fewer" : `Show all ${items.length} charts (${hiddenCount} more)`}
          </button>
          {!showAll && (
            <p className="text-xs text-slate-600">
              Showing the first {CHART_PREVIEW_LIMIT}. Drawing every chart at once can make the page slow to respond on
              a dataset this wide.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function formatBinLabel(start: number, end: number): string {
  return start === end ? `${start}` : `${start}–${end}`;
}

function NumericHistogram({ distribution }: { distribution: NumericDistribution }) {
  const data = distribution.bins.map((b) => ({
    label: formatBinLabel(b.bin_start, b.bin_end),
    count: b.count,
  }));

  return (
    <div className="glass-inner flex flex-col gap-2.5 rounded-xl p-4">
      <h4 className="text-sm font-medium text-slate-200">{distribution.column_name}</h4>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.06)" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10, fill: "#64748b" }} allowDecimals={false} />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              background: "rgba(15,23,42,0.95)",
              border: "1px solid rgba(148,163,184,0.1)",
              color: "#e2e8f0",
            }}
            cursor={{ fill: "rgba(96, 165, 250, 0.06)" }}
          />
          <Bar dataKey="count" fill={HISTOGRAM_COLOR} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CategoricalBarChart({ frequency }: { frequency: CategoricalFrequency }) {
  const data = frequency.categories.map((c) => ({ label: c.value, count: c.count }));

  return (
    <div className="glass-inner flex flex-col gap-2.5 rounded-xl p-4">
      <h4 className="text-sm font-medium text-slate-200">{frequency.column_name}</h4>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.06)" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} interval={0} angle={-30} textAnchor="end" height={50} />
          <YAxis tick={{ fontSize: 10, fill: "#64748b" }} allowDecimals={false} />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              background: "rgba(15,23,42,0.95)",
              border: "1px solid rgba(148,163,184,0.1)",
              color: "#e2e8f0",
            }}
            cursor={{ fill: "rgba(52, 211, 153, 0.06)" }}
          />
          <Bar dataKey="count" fill={FREQUENCY_COLOR} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function correlationCellStyle(value: number | null): React.CSSProperties {
  if (value == null) return { backgroundColor: "transparent" };
  const alpha = Math.abs(value) * 0.85 + (value !== 0 ? 0.08 : 0);
  const [r, g, b] = value >= 0 ? [96, 165, 250] : [248, 113, 113]; // DIVERGING_POSITIVE / DIVERGING_NEGATIVE as RGB
  return { backgroundColor: `rgba(${r}, ${g}, ${b}, ${Math.min(alpha, 1)})` };
}

function correlationTextStyle(value: number | null): React.CSSProperties {
  // Once the fill gets dark enough, flip to white text for contrast rather
  // than letting dark-on-dark become unreadable at high |correlation|.
  if (value == null) return {};
  return Math.abs(value) > 0.45 ? { color: "white" } : { color: "#cbd5e1" };
}

function CorrelationHeatmap({ matrix }: { matrix: CorrelationMatrix }) {
  // Which cell the pointer is over, so the matching row label and column header
  // can light up. On a wide matrix the sticky labels tell you *what* the axes are;
  // this tells you which pair the cell under your finger actually belongs to.
  const [hovered, setHovered] = useState<{ row: number; col: number } | null>(null);

  return (
    <div>
      {/*
        Both axes stay pinned while the matrix scrolls: the header row sticks to
        the top, the row-label column sticks to the left, and the corner cell sticks
        to both. Without this, swiping right on a wide matrix scrolls the column
        names out of view and every cell becomes an anonymous number.

        border-spacing is 0 rather than 1 on purpose — the gap between tiles is
        drawn with cell padding around an inner div instead. Real border-spacing
        leaves transparent gaps *between* the sticky cells, and scrolled content
        shows through them.
      */}
      <div className="corr-scroll max-h-[70vh] overflow-auto rounded-xl">
        <table className="border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="corr-sticky-corner sticky top-0 left-0 z-30 p-0.5" />
              {matrix.columns.map((col, j) => (
                <th
                  key={col}
                  scope="col"
                  className={`corr-sticky-head sticky top-0 z-20 p-0.5 font-medium transition-colors ${
                    hovered?.col === j ? "text-emerald-300" : "text-slate-500"
                  }`}
                >
                  <div className="flex h-10 w-24 items-end justify-center pb-1 text-center leading-tight break-words">
                    {col}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.columns.map((rowCol, i) => (
              <tr key={rowCol}>
                <th
                  scope="row"
                  className={`corr-sticky-head sticky left-0 z-10 p-0.5 text-right font-medium transition-colors ${
                    hovered?.row === i ? "text-emerald-300" : "text-slate-500"
                  }`}
                >
                  <div className="flex h-10 w-32 items-center justify-end pr-2 text-right leading-tight break-words">
                    {rowCol}
                  </div>
                </th>
                {matrix.matrix[i].map((value, j) => (
                  <td
                    key={matrix.columns[j]}
                    className="p-0.5"
                    title={`${rowCol} vs ${matrix.columns[j]}: ${value == null ? "undefined" : value.toFixed(2)}`}
                    onMouseEnter={() => setHovered({ row: i, col: j })}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <div
                      className={`flex h-10 w-24 items-center justify-center rounded-md text-center font-medium tabular-nums transition-shadow ${
                        hovered?.row === i || hovered?.col === j
                          ? "shadow-[inset_0_0_0_1px_rgba(52,211,153,0.55)]"
                          : ""
                      }`}
                      style={{ ...correlationCellStyle(value), ...correlationTextStyle(value) }}
                    >
                      {value == null ? "—" : value.toFixed(2)}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="inline-flex h-2.5 w-16 rounded-full" style={{ background: `linear-gradient(90deg, ${DIVERGING_NEGATIVE}, transparent)` }} />
        negative
        <span className="ml-2 inline-flex h-2.5 w-16 rounded-full" style={{ background: `linear-gradient(90deg, transparent, ${DIVERGING_POSITIVE})` }} />
        positive
        {matrix.columns.length > 4 && (
          <span className="ml-auto text-slate-600">Scroll the grid — row and column labels stay pinned.</span>
        )}
      </p>
    </div>
  );
}

function CorrelationSection({ matrix }: { matrix: CorrelationMatrix }) {
  const size = matrix.columns.length;
  const isHuge = size > CORRELATION_AUTO_RENDER_LIMIT;
  const [render, setRender] = useState(!isHuge);

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
        Correlation Matrix
        {isHuge && <span className="ml-2 normal-case tracking-normal text-slate-600">({size} × {size})</span>}
      </h3>
      <div className="section-divider" />
      {render ? (
        <CorrelationHeatmap matrix={matrix} />
      ) : (
        <div className="flex flex-col items-start gap-1.5">
          <button onClick={() => setRender(true)} className="btn-secondary rounded-xl px-4 py-2 text-sm font-medium">
            Render {size} × {size} matrix ({(size * size).toLocaleString()} cells)
          </button>
          <p className="text-xs text-slate-600">
            A matrix this wide is slow to draw and hard to read on screen. The PDF export lays it out across numbered
            blocks instead, which is usually the easier way to read it.
          </p>
        </div>
      )}
    </div>
  );
}

export function EdaView({ eda }: { eda: EdaReport }) {
  const hasNumeric = eda.numeric_distributions.length > 0;
  const hasCategorical = eda.categorical_frequencies.length > 0;

  if (!hasNumeric && !hasCategorical) return null;

  return (
    <div className="glass-card flex flex-col gap-6 rounded-2xl p-6">
      <h2 className="font-semibold text-slate-100 text-lg">Exploratory Data Analysis</h2>

      {hasNumeric && (
        <ChartSection
          title="Distributions"
          items={eda.numeric_distributions}
          keyOf={(dist) => dist.column_name}
          renderItem={(dist) => <NumericHistogram distribution={dist} />}
        />
      )}

      {hasCategorical && (
        <ChartSection
          title="Category Frequencies"
          items={eda.categorical_frequencies}
          keyOf={(freq) => freq.column_name}
          renderItem={(freq) => <CategoricalBarChart frequency={freq} />}
        />
      )}

      {eda.correlation_matrix && <CorrelationSection matrix={eda.correlation_matrix} />}
    </div>
  );
}
