from datetime import datetime, timezone
from types import SimpleNamespace

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Table

from app.services.eda import build_eda_payload
from app.services.pdf_report import (
    _correlation_colors,
    _correlation_story,
    generate_report_pdf,
)

# The frame width generate_report_pdf() actually renders into: letter minus its
# 0.6" side margins. Kept here so the width assertions below track the real page.
AVAILABLE_WIDTH = letter[0] - 2 * 0.6 * 72

# --- generate_report_pdf: FR-7 (quality report + EDA highlights + test results + model runs as PDF) ---


def _dataset(**overrides):
    defaults = {
        "original_filename": "sample.csv",
        "upload_time": datetime.now(timezone.utc),
        "row_count": 6,
        "column_count": 2,
        "duplicate_row_count": 0,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _numeric_column(**overrides):
    defaults = {
        "column_name": "age",
        "data_type": "numeric",
        "missing_count": 0,
        "missing_pct": 0.0,
        "unique_count": 6,
        "outlier_count": 1,
        "summary_stats": {"mean": 43.3, "median": 22.5, "std": 1.0, "min": 20, "max": 150},
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _categorical_column(**overrides):
    defaults = {
        "column_name": "city",
        "data_type": "categorical",
        "missing_count": 0,
        "missing_pct": 0.0,
        "unique_count": 3,
        "outlier_count": None,
        "summary_stats": {"top_value": "A", "top_frequency": 3},
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _test_result(**overrides):
    defaults = {
        "test_type": "anova",
        "column_a": "city",
        "column_b": "age",
        "statistic": 9.42,
        "p_value": 0.0012,
        "conclusion": "There is a statistically significant difference.",
        "created_at": datetime.now(timezone.utc),
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _model_run(**overrides):
    defaults = {
        "target_column": "age",
        "model_type": "regression",
        "algorithm": "random_forest",
        "metrics": {"r2": 0.87, "mae": 1.68, "rmse": 2.11},
        "feature_importance": {"city": 0.1, "salary": 0.9},  # deliberately out of order
        "created_at": datetime.now(timezone.utc),
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_generates_valid_pdf_bytes():
    import pandas as pd

    df = pd.DataFrame({"age": [20, 21, 22, 23, 24, 150], "city": ["A", "B", "A", "C", "B", "A"]})
    eda = build_eda_payload(df, {"age": "numeric", "city": "categorical"})
    columns = [_numeric_column(), _categorical_column()]

    pdf_bytes = generate_report_pdf(_dataset(), columns, eda, [], [])

    assert pdf_bytes.startswith(b"%PDF-")
    assert pdf_bytes.endswith(b"%%EOF\n") or b"%%EOF" in pdf_bytes[-16:]


def test_handles_no_correlation_matrix():
    import pandas as pd

    df = pd.DataFrame({"city": ["A", "B", "A"]})
    eda = build_eda_payload(df, {"city": "categorical"})
    columns = [_categorical_column()]

    pdf_bytes = generate_report_pdf(_dataset(column_count=1), columns, eda, [], [])

    assert pdf_bytes.startswith(b"%PDF-")


def test_handles_no_test_results():
    import pandas as pd

    df = pd.DataFrame({"age": [1, 2, 3]})
    eda = build_eda_payload(df, {"age": "numeric"})

    pdf_bytes = generate_report_pdf(_dataset(column_count=1), [_numeric_column()], eda, [], [])

    assert pdf_bytes.startswith(b"%PDF-")


def test_includes_test_results():
    import pandas as pd

    df = pd.DataFrame({"age": [1, 2, 3, 4], "city": ["A", "B", "A", "B"]})
    eda = build_eda_payload(df, {"age": "numeric", "city": "categorical"})
    columns = [_numeric_column(), _categorical_column()]

    pdf_bytes = generate_report_pdf(_dataset(), columns, eda, [_test_result()], [])

    assert pdf_bytes.startswith(b"%PDF-")


def test_handles_missing_summary_stats():
    import pandas as pd

    df = pd.DataFrame({"age": [None, None]})
    eda = build_eda_payload(df, {"age": "numeric"})
    column = _numeric_column(missing_count=2, missing_pct=100.0, unique_count=0, outlier_count=None, summary_stats=None)

    pdf_bytes = generate_report_pdf(_dataset(column_count=1), [column], eda, [], [])

    assert pdf_bytes.startswith(b"%PDF-")


def test_sanitizes_unsafe_characters_do_not_crash_generation():
    import pandas as pd

    df = pd.DataFrame({"age": [1, 2, 3]})
    eda = build_eda_payload(df, {"age": "numeric"})
    dataset = _dataset(original_filename='weird "name"\r\n.csv', column_count=1)

    pdf_bytes = generate_report_pdf(dataset, [_numeric_column()], eda, [], [])

    assert pdf_bytes.startswith(b"%PDF-")


def test_unbalanced_angle_bracket_in_filename_does_not_crash():
    # Paragraph() parses a mini-XML markup — "a<b" is unbalanced markup, not
    # just a literal character, and used to raise ValueError and crash the
    # whole report. Column names and filenames are user-controlled (from the
    # uploaded CSV's own headers/filename), so this is a realistic input.
    import pandas as pd

    df = pd.DataFrame({"age": [1, 2, 3]})
    eda = build_eda_payload(df, {"age": "numeric"})
    dataset = _dataset(original_filename="a<b report.csv", column_count=1)

    pdf_bytes = generate_report_pdf(dataset, [_numeric_column()], eda, [], [])

    assert pdf_bytes.startswith(b"%PDF-")


def test_unbalanced_angle_bracket_in_conclusion_does_not_crash():
    import pandas as pd

    df = pd.DataFrame({"age": [1, 2, 3]})
    eda = build_eda_payload(df, {"age": "numeric"})
    test_result = _test_result(conclusion="There is a<b difference (p=0.5000).")

    pdf_bytes = generate_report_pdf(_dataset(column_count=1), [_numeric_column()], eda, [test_result], [])

    assert pdf_bytes.startswith(b"%PDF-")


# --- Correlation matrix width handling (FR-4 / FR-7) ---


def _wide_eda(n_numeric: int):
    """An EDA payload whose correlation matrix has n_numeric columns."""
    import pandas as pd

    df = pd.DataFrame({f"long_metric_column_{i:02d}": [i, i + 1.5, i * 2, i + 4.25] for i in range(n_numeric)})
    return df, build_eda_payload(df, {c: "numeric" for c in df.columns})


def _blocks(story) -> list[Table]:
    return [f for f in story if isinstance(f, Table)]


def test_narrow_correlation_matrix_stays_a_single_block():
    _, eda = _wide_eda(5)

    blocks = _blocks(_correlation_story(eda.correlation_matrix, AVAILABLE_WIDTH, getSampleStyleSheet()["BodyText"]))

    assert len(blocks) == 1


def test_wide_correlation_matrix_splits_into_multiple_blocks():
    _, eda = _wide_eda(40)

    blocks = _blocks(_correlation_story(eda.correlation_matrix, AVAILABLE_WIDTH, getSampleStyleSheet()["BodyText"]))

    assert len(blocks) > 1


def test_every_correlation_column_survives_the_split():
    # The reported bug: a matrix wider than the page silently lost its trailing
    # columns, because reportlab runs an over-wide table off the paper rather than
    # reflowing it. Every one of the 40 columns must appear in exactly one block.
    _, eda = _wide_eda(40)

    blocks = _blocks(_correlation_story(eda.correlation_matrix, AVAILABLE_WIDTH, getSampleStyleSheet()["BodyText"]))

    # Header row is [label spacer, col 1, col 2, ...] — count the value columns.
    rendered = sum(len(b._cellvalues[0]) - 1 for b in blocks)
    assert rendered == 40


def test_every_correlation_block_fits_the_page_width():
    _, eda = _wide_eda(40)

    blocks = _blocks(_correlation_story(eda.correlation_matrix, AVAILABLE_WIDTH, getSampleStyleSheet()["BodyText"]))

    for block in blocks:
        assert sum(block._argW) <= AVAILABLE_WIDTH


def test_every_correlation_block_repeats_all_rows():
    # Each block is a horizontal slice: fewer columns, but always every row, so a
    # reader never has to cross-reference two blocks to find one row's label.
    _, eda = _wide_eda(40)

    blocks = _blocks(_correlation_story(eda.correlation_matrix, AVAILABLE_WIDTH, getSampleStyleSheet()["BodyText"]))

    for block in blocks:
        assert len(block._cellvalues) == 41  # 40 rows + header


def test_wide_correlation_matrix_generates_a_valid_pdf():
    df, eda = _wide_eda(40)
    columns = [_numeric_column(column_name=c) for c in df.columns]

    pdf_bytes = generate_report_pdf(_dataset(column_count=40), columns, eda, [], [])

    assert pdf_bytes.startswith(b"%PDF-")


def test_correlation_colors_diverge_by_sign():
    positive, _ = _correlation_colors(0.9)
    negative, _ = _correlation_colors(-0.9)
    neutral, _ = _correlation_colors(0.0)

    assert positive.blue > positive.red  # blue-leaning
    assert negative.red > negative.blue  # red-leaning
    assert (neutral.red, neutral.green, neutral.blue) == (1, 1, 1)  # white at zero


def test_correlation_colors_handle_none():
    fill, text = _correlation_colors(None)

    assert (fill.red, fill.green, fill.blue) == (1, 1, 1)
    assert (text.red, text.green, text.blue) == (0, 0, 0)


# --- Baseline model section (FR-8, FR-9) ---


def test_handles_no_model_runs():
    import pandas as pd

    df = pd.DataFrame({"age": [1, 2, 3]})
    eda = build_eda_payload(df, {"age": "numeric"})

    pdf_bytes = generate_report_pdf(_dataset(column_count=1), [_numeric_column()], eda, [], [])

    assert pdf_bytes.startswith(b"%PDF-")


def test_includes_model_runs():
    import pandas as pd

    df = pd.DataFrame({"age": [1, 2, 3, 4], "city": ["A", "B", "A", "B"]})
    eda = build_eda_payload(df, {"age": "numeric", "city": "categorical"})
    columns = [_numeric_column(), _categorical_column()]

    pdf_bytes = generate_report_pdf(_dataset(), columns, eda, [], [_model_run()])

    assert pdf_bytes.startswith(b"%PDF-")


def test_model_run_feature_importance_is_sorted_regardless_of_input_order():
    # _model_run() deliberately builds feature_importance as {"city": 0.1, "salary": 0.9}
    # — out of order — mirroring the real JSONB-ordering bug found in M5. The
    # PDF's own text extraction isn't asserted here (reportlab doesn't make
    # that trivial), but this at minimum proves generation doesn't crash and
    # exercises the same sort_feature_importance() path used everywhere else.
    import pandas as pd

    df = pd.DataFrame({"age": [1, 2, 3, 4]})
    eda = build_eda_payload(df, {"age": "numeric"})

    pdf_bytes = generate_report_pdf(
        _dataset(column_count=1), [_numeric_column()], eda, [], [_model_run(feature_importance={"z": 0.01, "a": 0.99})]
    )

    assert pdf_bytes.startswith(b"%PDF-")


def test_classification_model_run_metrics_render():
    import pandas as pd

    df = pd.DataFrame({"bracket": ["high", "low", "high", "low"]})
    eda = build_eda_payload(df, {"bracket": "categorical"})
    run = _model_run(
        target_column="bracket",
        model_type="classification",
        metrics={"accuracy": 1.0, "precision": 1.0, "recall": 1.0, "f1": 1.0},
        feature_importance={"age": 0.6, "salary": 0.4},
    )

    pdf_bytes = generate_report_pdf(_dataset(column_count=1), [_categorical_column()], eda, [], [run])

    assert pdf_bytes.startswith(b"%PDF-")


def test_unbalanced_angle_bracket_in_target_column_does_not_crash():
    import pandas as pd

    df = pd.DataFrame({"age": [1, 2, 3, 4]})
    eda = build_eda_payload(df, {"age": "numeric"})
    run = _model_run(target_column="a<b", feature_importance={"age": 1.0})

    pdf_bytes = generate_report_pdf(_dataset(column_count=1), [_numeric_column()], eda, [], [run])

    assert pdf_bytes.startswith(b"%PDF-")
