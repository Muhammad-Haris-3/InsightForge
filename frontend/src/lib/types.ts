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

export interface HistogramBin {
  bin_start: number;
  bin_end: number;
  count: number;
}

export interface NumericDistribution {
  column_name: string;
  bins: HistogramBin[];
}

export interface CategoryCount {
  value: string;
  count: number;
}

export interface CategoricalFrequency {
  column_name: string;
  categories: CategoryCount[];
}

export interface CorrelationMatrix {
  columns: string[];
  matrix: (number | null)[][];
}

export interface EdaReport {
  numeric_distributions: NumericDistribution[];
  categorical_frequencies: CategoricalFrequency[];
  correlation_matrix: CorrelationMatrix | null;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
