import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CategoricalFrequency, CorrelationMatrix, EdaReport, NumericDistribution } from "@/lib/types";

// Validated categorical slots (dataviz skill palette.md) — distinct hues per
// chart type rather than eyeballed colors, kept consistent everywhere a chart
// of that kind appears in the app.
const HISTOGRAM_COLOR = "#2a78d6"; // slot 1, blue
const FREQUENCY_COLOR = "#1baf7a"; // slot 3, aqua
const DIVERGING_POSITIVE = "#2a78d6"; // blue
const DIVERGING_NEGATIVE = "#e34948"; // red

function formatBinLabel(start: number, end: number): string {
  return start === end ? `${start}` : `${start}–${end}`;
}

function NumericHistogram({ distribution }: { distribution: NumericDistribution }) {
  const data = distribution.bins.map((b) => ({
    label: formatBinLabel(b.bin_start, b.bin_end),
    count: b.count,
  }));

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-950/40">
      <h4 className="text-sm font-medium text-black dark:text-zinc-50">{distribution.column_name}</h4>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} cursor={{ fill: "rgba(42, 120, 214, 0.06)" }} />
          <Bar dataKey="count" fill={HISTOGRAM_COLOR} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CategoricalBarChart({ frequency }: { frequency: CategoricalFrequency }) {
  const data = frequency.categories.map((c) => ({ label: c.value, count: c.count }));

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-950/40">
      <h4 className="text-sm font-medium text-black dark:text-zinc-50">{frequency.column_name}</h4>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={50} />
          <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} cursor={{ fill: "rgba(27, 175, 122, 0.06)" }} />
          <Bar dataKey="count" fill={FREQUENCY_COLOR} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function correlationCellStyle(value: number | null): React.CSSProperties {
  if (value == null) return { backgroundColor: "transparent" };
  const alpha = Math.abs(value) * 0.85 + (value !== 0 ? 0.08 : 0);
  const [r, g, b] = value >= 0 ? [42, 120, 214] : [227, 73, 72]; // DIVERGING_POSITIVE / DIVERGING_NEGATIVE as RGB
  return { backgroundColor: `rgba(${r}, ${g}, ${b}, ${Math.min(alpha, 1)})` };
}

function correlationTextStyle(value: number | null): React.CSSProperties {
  // Once the fill gets dark enough, flip to white text for contrast rather
  // than letting dark-on-dark become unreadable at high |correlation|.
  if (value == null) return {};
  return Math.abs(value) > 0.45 ? { color: "white" } : {};
}

function CorrelationHeatmap({ matrix }: { matrix: CorrelationMatrix }) {
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-1 text-xs">
        <thead>
          <tr>
            <th className="p-1" />
            {matrix.columns.map((col) => (
              <th key={col} className="whitespace-nowrap p-1 font-medium text-zinc-500">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.columns.map((rowCol, i) => (
            <tr key={rowCol}>
              <th className="whitespace-nowrap p-1 pr-2 text-right font-medium text-zinc-500">{rowCol}</th>
              {matrix.matrix[i].map((value, j) => (
                <td
                  key={matrix.columns[j]}
                  className="h-10 w-10 rounded-md text-center font-medium tabular-nums text-zinc-800 dark:text-zinc-100"
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
      <p className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
        <span className="inline-flex h-2 w-16 rounded-full" style={{ background: DIVERGING_NEGATIVE }} />
        negative
        <span className="ml-2 inline-flex h-2 w-16 rounded-full" style={{ background: DIVERGING_POSITIVE }} />
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
    <div className="flex flex-col gap-6 rounded-2xl border border-zinc-200/70 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="font-semibold text-black dark:text-zinc-50">Exploratory Data Analysis</h2>

      {hasNumeric && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">Distributions</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {eda.numeric_distributions.map((dist) => (
              <NumericHistogram key={dist.column_name} distribution={dist} />
            ))}
          </div>
        </div>
      )}

      {hasCategorical && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">Category Frequencies</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {eda.categorical_frequencies.map((freq) => (
              <CategoricalBarChart key={freq.column_name} frequency={freq} />
            ))}
          </div>
        </div>
      )}

      {eda.correlation_matrix && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">Correlation Matrix</h3>
          <CorrelationHeatmap matrix={eda.correlation_matrix} />
        </div>
      )}
    </div>
  );
}
