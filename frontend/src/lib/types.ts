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
  // Populated only on the POST /upload response — see EdaView wiring in UploadPanel.
  eda?: EdaReport | null;
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

export type TestType = "t_test" | "chi_square" | "anova";

export interface TestResult {
  id: string;
  dataset_id: string;
  test_type: TestType;
  column_a: string;
  column_b: string;
  statistic: number;
  p_value: number;
  conclusion: string;
  created_at: string;
}

export type ModelType = "regression" | "classification";

export interface ModelRun {
  id: string;
  dataset_id: string;
  target_column: string;
  model_type: ModelType;
  algorithm: string;
  metrics: Record<string, number>;
  feature_importance: Record<string, number> | null;
  feature_importance_summary: string;
  // Null for runs recorded before the training cap existed. They differ when a
  // large upload was capped to keep the forest inside the backend's memory limit.
  training_row_count: number | null;
  available_row_count: number | null;
  created_at: string;
}

export interface Prediction {
  prediction: number | string;
  probabilities: Record<string, number> | null;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
