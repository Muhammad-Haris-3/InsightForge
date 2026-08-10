import type { ColumnDataType, ColumnProfile, QualityReport } from "@/lib/types";

const TYPE_STYLES: Record<ColumnDataType, string> = {
  numeric: "bg-blue-500/15 text-blue-300 border border-blue-500/20",
  categorical: "bg-violet-500/15 text-violet-300 border border-violet-500/20",
  datetime: "bg-amber-500/15 text-amber-300 border border-amber-500/20",
  boolean: "bg-teal-500/15 text-teal-300 border border-teal-500/20",
  text: "bg-slate-500/15 text-slate-300 border border-slate-500/20",
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
    <div className="glass-card flex flex-col gap-5 rounded-2xl p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-slate-100 text-lg">{report.original_filename}</h2>
        <span className="text-sm text-slate-500 font-mono">{formatBytes(report.file_size_bytes)}</span>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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

      <div className="overflow-x-auto rounded-xl border border-slate-700/30">
        <table className="premium-table min-w-max">
          <thead>
            <tr>
              <th>Column</th>
              <th>Type</th>
              <th>Missing</th>
              <th>Unique</th>
              <th>Outliers</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            {report.columns.map((col) => (
              <tr key={col.column_name}>
                <td className="font-medium text-slate-200">{col.column_name}</td>
                <td>
                  <span className={`badge ${TYPE_STYLES[col.data_type]}`}>
                    {col.data_type}
                  </span>
                </td>
                <td>
                  {col.missing_count > 0 ? `${col.missing_count} (${col.missing_pct}%)` : "0"}
                </td>
                <td>{col.unique_count}</td>
                <td>{col.outlier_count ?? "—"}</td>
                <td className="text-slate-500 text-xs">{formatSummary(col)}</td>
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
    <div className="stat-card">
      <dt className="text-xs text-slate-500 uppercase tracking-wider">{label}</dt>
      <dd
        className={`text-xl font-semibold tabular-nums mt-1 ${warn ? "text-amber-400" : "text-slate-100"}`}
      >
        {value}
      </dd>
    </div>
  );
}
