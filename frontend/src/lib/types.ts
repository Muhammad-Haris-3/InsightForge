export type ColumnDataType = "numeric" | "categorical" | "datetime" | "boolean" | "text";

export interface ColumnProfile {
  column_name: string;
  data_type: ColumnDataType;
  missing_count: number;
  missing_pct: number;
  unique_count: number;
  outlier_count: number | null;
  summary_stats: Record<string, unknown> | null;
}

export interface QualityReport {
  id: string;
  original_filename: string;
  row_count: number;
  column_count: number;
  file_size_bytes: number;
  duplicate_row_count: number;
  upload_time: string;
  columns: ColumnProfile[];
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
