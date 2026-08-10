import type { ColumnDataType, ColumnProfile, QualityReport } from "@/lib/types";

const TYPE_STYLES: Record<ColumnDataType, string> = {
  numeric: "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300",
  categorical: "bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-300",
  datetime: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  boolean: "bg-teal-100 text-teal-800 dark:bg-teal-950/50 dark:text-teal-300",
  text: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

function formatSummary(col: ColumnProfile): string {
  const s = col.summary_stats;
  if (!s) return "—";
  if (col.data_type === "numeric") {
    const { mean, median, min, max } = s as Record<string, number | null>;
    if (mean == null) return "—";
    return `mean ${mean} · median ${median} · range ${min}–${max}`;
  }
  const { top_value, top_frequency } = s as { top_value: string | null; top_frequency: number };
  if (top_value == null) return "—";
  return `top: "${top_value}" (×${top_frequency})`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function QualityReportView({ report }: { report: QualityReport }) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-black dark:text-zinc-50">{report.original_filename}</h2>
        <span className="text-sm text-zinc-500">{formatBytes(report.file_size_bytes)}</span>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Stat label="Rows" value={report.row_count.toLocaleString()} />
        <Stat label="Columns" value={report.column_count.toLocaleString()} />
        <Stat
          label="Duplicate rows"
          value={report.duplicate_row_count.toLocaleString()}
          warn={report.duplicate_row_count > 0}
        />
        <Stat
          label="Missing cells"
          value={report.columns.reduce((sum, c) => sum + c.missing_count, 0).toLocaleString()}
          warn={report.columns.some((c) => c.missing_count > 0)}
        />
      </dl>

      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
              <th className="py-2 pr-4 font-medium">Column</th>
              <th className="py-2 pr-4 font-medium">Type</th>
              <th className="py-2 pr-4 font-medium">Missing</th>
              <th className="py-2 pr-4 font-medium">Unique</th>
              <th className="py-2 pr-4 font-medium">Outliers</th>
              <th className="py-2 pr-4 font-medium">Summary</th>
            </tr>
          </thead>
          <tbody>
            {report.columns.map((col) => (
              <tr key={col.column_name} className="border-b border-zinc-100 dark:border-zinc-800/60">
                <td className="py-2 pr-4 font-medium text-black dark:text-zinc-50">{col.column_name}</td>
                <td className="py-2 pr-4">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_STYLES[col.data_type]}`}>
                    {col.data_type}
                  </span>
                </td>
                <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">
                  {col.missing_count > 0 ? `${col.missing_count} (${col.missing_pct}%)` : "0"}
                </td>
                <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">{col.unique_count}</td>
                <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">{col.outlier_count ?? "—"}</td>
                <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">{formatSummary(col)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-zinc-500">{label}</dt>
      <dd className={`text-lg font-semibold ${warn ? "text-amber-600 dark:text-amber-400" : "text-black dark:text-zinc-50"}`}>
        {value}
      </dd>
    </div>
  );
}
