import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CategoricalFrequency, CorrelationMatrix, EdaReport, NumericDistribution } from "@/lib/types";

// Validated categorical slots (dataviz skill palette.md) — distinct hues per
// chart type rather than eyeballed colors, kept consistent everywhere a chart
// of that kind appears in the app.
const HISTOGRAM_COLOR = "#60a5fa"; // brighter blue for dark bg
const FREQUENCY_COLOR = "#34d399"; // emerald for dark bg
const DIVERGING_POSITIVE = "#60a5fa"; // blue
const DIVERGING_NEGATIVE = "#f87171"; // brighter red for dark bg

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
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-1 text-xs">
        <thead>
          <tr>
            <th className="p-1" />
            {matrix.columns.map((col) => (
              <th key={col} className="whitespace-nowrap p-1 font-medium text-slate-500">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.columns.map((rowCol, i) => (
            <tr key={rowCol}>
              <th className="whitespace-nowrap p-1 pr-2 text-right font-medium text-slate-500">{rowCol}</th>
              {matrix.matrix[i].map((value, j) => (
                <td
                  key={matrix.columns[j]}
                  className="h-10 w-10 rounded-md text-center font-medium tabular-nums"
                  style={{ ...correlationCellStyle(value), ...correlationTextStyle(value) }}
                  title={value == null ? "undefined" : value.toFixed(2)}
                >
                  {value == null ? "—" : value.toFixed(2)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 flex items-center gap-2 text-xs text-slate-500">
        <span className="inline-flex h-2.5 w-16 rounded-full" style={{ background: `linear-gradient(90deg, ${DIVERGING_NEGATIVE}, transparent)` }} />
        negative
        <span className="ml-2 inline-flex h-2.5 w-16 rounded-full" style={{ background: `linear-gradient(90deg, transparent, ${DIVERGING_POSITIVE})` }} />
        positive
      </p>
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
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Distributions</h3>
          <div className="section-divider" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {eda.numeric_distributions.map((dist) => (
              <NumericHistogram key={dist.column_name} distribution={dist} />
            ))}
          </div>
        </div>
      )}

      {hasCategorical && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Category Frequencies</h3>
          <div className="section-divider" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {eda.categorical_frequencies.map((freq) => (
              <CategoricalBarChart key={freq.column_name} frequency={freq} />
            ))}
          </div>
        </div>
      )}

      {eda.correlation_matrix && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Correlation Matrix</h3>
          <div className="section-divider" />
          <CorrelationHeatmap matrix={eda.correlation_matrix} />
        </div>
      )}
    </div>
  );
}
