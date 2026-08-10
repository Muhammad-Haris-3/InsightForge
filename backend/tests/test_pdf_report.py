from datetime import datetime, timezone
from types import SimpleNamespace

from app.services.eda import build_eda_payload
from app.services.pdf_report import generate_report_pdf

# --- generate_report_pdf: FR-7 (quality report + EDA highlights + test results as PDF) ---


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


def test_generates_valid_pdf_bytes():
    import pandas as pd

    df = pd.DataFrame({"age": [20, 21, 22, 23, 24, 150], "city": ["A", "B", "A", "C", "B", "A"]})
    eda = build_eda_payload(df, {"age": "numeric", "city": "categorical"})
    columns = [_numeric_column(), _categorical_column()]

    pdf_bytes = generate_report_pdf(_dataset(), columns, eda, [])

    assert pdf_bytes.startswith(b"%PDF-")
    assert pdf_bytes.endswith(b"%%EOF\n") or b"%%EOF" in pdf_bytes[-16:]


def test_handles_no_correlation_matrix():
    import pandas as pd

    df = pd.DataFrame({"city": ["A", "B", "A"]})
    eda = build_eda_payload(df, {"city": "categorical"})
    columns = [_categorical_column()]

    pdf_bytes = generate_report_pdf(_dataset(column_count=1), columns, eda, [])

    assert pdf_bytes.startswith(b"%PDF-")


def test_handles_no_test_results():
    import pandas as pd

    df = pd.DataFrame({"age": [1, 2, 3]})
    eda = build_eda_payload(df, {"age": "numeric"})

    pdf_bytes = generate_report_pdf(_dataset(column_count=1), [_numeric_column()], eda, [])

    assert pdf_bytes.startswith(b"%PDF-")


def test_includes_test_results():
    import pandas as pd

    df = pd.DataFrame({"age": [1, 2, 3, 4], "city": ["A", "B", "A", "B"]})
    eda = build_eda_payload(df, {"age": "numeric", "city": "categorical"})
    columns = [_numeric_column(), _categorical_column()]

    pdf_bytes = generate_report_pdf(_dataset(), columns, eda, [_test_result()])

    assert pdf_bytes.startswith(b"%PDF-")


def test_handles_missing_summary_stats():
    import pandas as pd

    df = pd.DataFrame({"age": [None, None]})
    eda = build_eda_payload(df, {"age": "numeric"})
    column = _numeric_column(missing_count=2, missing_pct=100.0, unique_count=0, outlier_count=None, summary_stats=None)

    pdf_bytes = generate_report_pdf(_dataset(column_count=1), [column], eda, [])

    assert pdf_bytes.startswith(b"%PDF-")


def test_sanitizes_unsafe_characters_do_not_crash_generation():
    import pandas as pd

    df = pd.DataFrame({"age": [1, 2, 3]})
    eda = build_eda_payload(df, {"age": "numeric"})
    dataset = _dataset(original_filename='weird "name"\r\n.csv', column_count=1)

    pdf_bytes = generate_report_pdf(dataset, [_numeric_column()], eda, [])

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

    pdf_bytes = generate_report_pdf(dataset, [_numeric_column()], eda, [])

    assert pdf_bytes.startswith(b"%PDF-")


def test_unbalanced_angle_bracket_in_conclusion_does_not_crash():
    import pandas as pd

    df = pd.DataFrame({"age": [1, 2, 3]})
    eda = build_eda_payload(df, {"age": "numeric"})
    test_result = _test_result(conclusion="There is a<b difference (p=0.5000).")

    pdf_bytes = generate_report_pdf(_dataset(column_count=1), [_numeric_column()], eda, [test_result])

    assert pdf_bytes.startswith(b"%PDF-")
