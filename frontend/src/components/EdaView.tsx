import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CategoricalFrequency, CorrelationMatrix, EdaReport, NumericDistribution } from "@/lib/types";

function formatBinLabel(start: number, end: number): string {
  return start === end ? `${start}` : `${start}–${end}`;
}

function NumericHistogram({ distribution }: { distribution: NumericDistribution }) {
  const data = distribution.bins.map((b) => ({
    label: formatBinLabel(b.bin_start, b.bin_end),
    count: b.count,
  }));

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-medium text-black dark:text-zinc-50">{distribution.column_name}</h4>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
          <Tooltip contentStyle={{ fontSize: 12 }} />
          <Bar dataKey="count" fill="#3b82f6" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CategoricalBarChart({ frequency }: { frequency: CategoricalFrequency }) {
  const data = frequency.categories.map((c) => ({ label: c.value, count: c.count }));

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-medium text-black dark:text-zinc-50">{frequency.column_name}</h4>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={50} />
          <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
          <Tooltip contentStyle={{ fontSize: 12 }} />
          <Bar dataKey="count" fill="#a855f7" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function correlationCellStyle(value: number | null): React.CSSProperties {
  if (value == null) return { backgroundColor: "transparent" };
  const alpha = Math.abs(value);
  const color = value >= 0 ? `rgba(16, 185, 129, ${alpha})` : `rgba(239, 68, 68, ${alpha})`;
  return { backgroundColor: color };
}

function CorrelationHeatmap({ matrix }: { matrix: CorrelationMatrix }) {
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-xs">
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
                  className="h-10 w-10 border border-zinc-100 text-center dark:border-zinc-800"
                  style={correlationCellStyle(value)}
                  title={value == null ? "undefined" : value.toFixed(2)}
                >
                  {value == null ? "—" : value.toFixed(2)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EdaView({ eda }: { eda: EdaReport }) {
  const hasNumeric = eda.numeric_distributions.length > 0;
  const hasCategorical = eda.categorical_frequencies.length > 0;

  if (!hasNumeric && !hasCategorical) return null;

  return (
    <div className="flex flex-col gap-6 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
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
