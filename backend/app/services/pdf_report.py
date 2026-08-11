"""PDF summary export: quality report + EDA highlights + test results + model runs (FR-7)."""

import io
from datetime import datetime, timezone
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.models import ColumnProfile, Dataset, ModelRun, TestResult
from app.services.eda import EdaPayload
from app.services.modeling import describe_feature_importance, sort_feature_importance

HEADER_BG = colors.HexColor("#18181b")  # zinc-900
ROW_ALT_BG = colors.HexColor("#f4f4f5")  # zinc-100
BORDER_COLOR = colors.HexColor("#d4d4d8")  # zinc-300

# Correlation matrix layout. The matrix is the one table whose width grows with
# the dataset — n numeric columns means n+1 table columns — so unlike every other
# table here it will run off the page unless it is measured and split. These are
# the pieces of that measurement; see _correlation_story().
CORR_LABEL_WIDTH = 118  # row-label column ("12. some_column_name"), wraps as a Paragraph
CORR_CELL_WIDTH = 24  # one value cell: "-0.42" at 7pt is ~18pt plus 2pt padding a side
CORR_FONT_SIZE = 7

# Same diverging pair the web heatmap uses (EdaView.tsx), so a printed matrix and
# the on-screen one read as the same artifact.
CORR_POSITIVE = colors.HexColor("#60a5fa")  # blue
CORR_NEGATIVE = colors.HexColor("#f87171")  # red

TEST_TYPE_LABELS = {"t_test": "t-test", "chi_square": "Chi-square", "anova": "ANOVA"}
MODEL_TYPE_LABELS = {"regression": "Regression", "classification": "Classification"}
METRIC_LABELS = {
    "r2": "R²",
    "mae": "MAE",
    "rmse": "RMSE",
    "accuracy": "Accuracy",
    "precision": "Precision",
    "recall": "Recall",
    "f1": "F1",
}


def _format_metrics(metrics: dict[str, float]) -> str:
    return ", ".join(f"{METRIC_LABELS.get(k, k)}={v:.4f}" for k, v in metrics.items())


def _column_summary(col: ColumnProfile) -> str:
    stats = col.summary_stats
    if not stats:
        return "-"
    if col.data_type == "numeric":
        if stats.get("mean") is None:
            return "-"
        return f"mean {stats['mean']:g}, median {stats['median']:g}, range {stats['min']:g}-{stats['max']:g}"
    top_value, top_frequency = stats.get("top_value"), stats.get("top_frequency")
    if top_value is None:
        return "-"
    return f'top: "{top_value}" (x{top_frequency})'


def _table_style(header_rows: int = 1) -> TableStyle:
    return TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, header_rows - 1), HEADER_BG),
            ("TEXTCOLOR", (0, 0), (-1, header_rows - 1), colors.white),
            ("FONTNAME", (0, 0), (-1, header_rows - 1), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("ROWBACKGROUNDS", (0, header_rows), (-1, -1), [colors.white, ROW_ALT_BG]),
            ("GRID", (0, 0), (-1, -1), 0.5, BORDER_COLOR),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]
    )


def _correlation_colors(value: float | None) -> tuple[colors.Color, colors.Color]:
    """Cell fill and text color for one correlation value, mirroring the web heatmap:
    blue for positive, red for negative, saturation tracking |value|."""
    if value is None:
        return colors.white, colors.black
    intensity = min(abs(value), 1.0)
    target = CORR_POSITIVE if value >= 0 else CORR_NEGATIVE
    fill = colors.Color(
        1 - (1 - target.red) * intensity,
        1 - (1 - target.green) * intensity,
        1 - (1 - target.blue) * intensity,
    )
    # Flip to white text once the fill is dark enough that black stops reading.
    return fill, (colors.white if intensity > 0.65 else colors.black)


def _correlation_block_table(
    all_columns: list[str],
    matrix: list[list[float | None]],
    start: int,
    end: int,
    label_style: ParagraphStyle,
    header_style: ParagraphStyle,
) -> Table:
    """Build one horizontal slice of the matrix: every row, but only columns [start:end).

    The header cells carry the column's *index* rather than its name. Names are far
    wider than a value cell, so naming both axes would force either a cell wide
    enough for the longest header (a handful of columns per page) or truncation.
    Indexing the top axis keeps a value cell value-sized, and the row labels — which
    are spelled out in full — supply the number-to-name key for both axes, since a
    correlation matrix is symmetric and both axes list the same columns.
    """
    header = [""] + [Paragraph(f"<b>{i + 1}</b>", header_style) for i in range(start, end)]
    rows = [header]
    for row_index, row_values in enumerate(matrix):
        label = escape(all_columns[row_index])
        cells = [f"{v:.2f}" if v is not None else "-" for v in row_values[start:end]]
        rows.append([Paragraph(f"{row_index + 1}. {label}", label_style), *cells])

    table = Table(
        rows,
        hAlign="LEFT",
        repeatRows=1,
        colWidths=[CORR_LABEL_WIDTH] + [CORR_CELL_WIDTH] * (end - start),
    )

    style = [
        ("BACKGROUND", (0, 0), (-1, 0), HEADER_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), CORR_FONT_SIZE),
        ("GRID", (0, 0), (-1, -1), 0.25, BORDER_COLOR),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (1, 0), (-1, -1), "CENTER"),
        # Tighter than _table_style's 6pt — the padding alone would otherwise be
        # half the width of a value cell.
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]

    for row_index, row_values in enumerate(matrix):
        for offset, value in enumerate(row_values[start:end]):
            fill, text_color = _correlation_colors(value)
            cell = (offset + 1, row_index + 1)
            style.append(("BACKGROUND", cell, cell, fill))
            style.append(("TEXTCOLOR", cell, cell, text_color))

    table.setStyle(TableStyle(style))
    return table


def _correlation_story(corr, available_width: float, body_style: ParagraphStyle) -> list:
    """Render the correlation matrix, splitting it across as many tables as it takes.

    A wide dataset produces a matrix wider than the page. ReportLab does not reflow
    an over-wide table — it just runs the surplus columns off the edge of the paper,
    which is why columns went missing from the export. So the columns are sliced into
    blocks that each fit the frame, and every block repeats the full row labels.
    """
    max_cells = max(1, int((available_width - CORR_LABEL_WIDTH) // CORR_CELL_WIDTH))
    total = len(corr.columns)

    label_style = ParagraphStyle(
        "CorrLabel", fontName="Helvetica", fontSize=CORR_FONT_SIZE, leading=CORR_FONT_SIZE + 1.5
    )
    header_style = ParagraphStyle(
        "CorrHeader",
        fontName="Helvetica-Bold",
        fontSize=CORR_FONT_SIZE,
        leading=CORR_FONT_SIZE + 1.5,
        textColor=colors.white,
        alignment=1,  # centered
    )

    story: list = []
    if total > max_cells:
        story.append(
            Paragraph(
                f"{total} numeric columns — too wide for one page, so the matrix is split into "
                f"blocks of up to {max_cells} columns below. Columns are numbered along the top; "
                "the numbered row labels are the key (the matrix is symmetric, so the same "
                "numbering applies to both axes).",
                body_style,
            )
        )
    else:
        story.append(
            Paragraph(
                "Columns are numbered along the top — the numbered row labels are the key.",
                body_style,
            )
        )

    for start in range(0, total, max_cells):
        end = min(start + max_cells, total)
        if total > max_cells:
            story.append(Spacer(1, 8))
            story.append(Paragraph(f"<b>Columns {start + 1}–{end} of {total}</b>", body_style))
            story.append(Spacer(1, 4))
        story.append(
            _correlation_block_table(corr.columns, corr.matrix, start, end, label_style, header_style)
        )

    return story


def generate_report_pdf(
    dataset: Dataset,
    columns: list[ColumnProfile],
    eda: EdaPayload,
    test_results: list[TestResult],
    model_runs: list[ModelRun],
) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        topMargin=0.6 * inch,
        bottomMargin=0.6 * inch,
        leftMargin=0.6 * inch,
        rightMargin=0.6 * inch,
    )
    styles = getSampleStyleSheet()
    heading_style = ParagraphStyle("SectionHeading", parent=styles["Heading2"], spaceBefore=16, spaceAfter=6)
    body_style = styles["BodyText"]

    story = [
        Paragraph("InsightForge — Data Analysis Report", styles["Title"]),
        # escape() because original_filename is user-supplied and Paragraph parses
        # a mini-XML markup — an unbalanced "<" (e.g. a filename like "a<b.csv")
        # would otherwise raise a ValueError and crash the whole report.
        Paragraph(escape(dataset.original_filename), styles["Heading3"]),
        Paragraph(
            f"Uploaded {dataset.upload_time.strftime('%Y-%m-%d %H:%M UTC')} · "
            f"Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
            body_style,
        ),
        Spacer(1, 12),
    ]

    # --- Overview ---
    missing_cells = sum(c.missing_count for c in columns)
    overview_rows = [
        ["Rows", "Columns", "Duplicate rows", "Missing cells"],
        [str(dataset.row_count), str(dataset.column_count), str(dataset.duplicate_row_count), str(missing_cells)],
    ]
    overview_table = Table(overview_rows, hAlign="LEFT")
    overview_table.setStyle(_table_style())
    story.append(overview_table)

    # --- Data quality report (FR-3) ---
    story.append(Paragraph("Data Quality Report", heading_style))
    quality_rows = [["Column", "Type", "Missing", "Unique", "Outliers", "Summary"]]
    for col in columns:
        missing = f"{col.missing_count} ({col.missing_pct}%)" if col.missing_count else "0"
        quality_rows.append(
            [
                # Paragraphs (and explicit colWidths below) so a long column name or
                # summary wraps inside its cell. Plain strings in a Table cell don't
                # wrap — they overflow into the neighbouring column and, on a wide
                # enough row, off the edge of the page entirely.
                Paragraph(escape(col.column_name), body_style),
                col.data_type,
                missing,
                str(col.unique_count),
                str(col.outlier_count) if col.outlier_count is not None else "-",
                Paragraph(escape(_column_summary(col)), body_style),
            ]
        )
    quality_table = Table(
        quality_rows, hAlign="LEFT", repeatRows=1, colWidths=[110, 52, 58, 45, 45, 210]
    )
    quality_table.setStyle(_table_style())
    story.append(quality_table)

    # --- EDA highlight: correlation matrix (FR-4) ---
    story.append(Paragraph("EDA Highlights — Correlation Matrix", heading_style))
    if eda.correlation_matrix is None:
        story.append(Paragraph("Fewer than 2 numeric columns — no correlation matrix to show.", body_style))
    else:
        story.extend(_correlation_story(eda.correlation_matrix, doc.width, body_style))

    # --- Statistical test results (FR-5, FR-6) ---
    story.append(Paragraph("Statistical Test Results", heading_style))
    if not test_results:
        story.append(Paragraph("No statistical tests have been run on this dataset yet.", body_style))
    else:
        test_rows = [["Test", "Column A", "Column B", "Statistic", "p-value", "Conclusion"]]
        for t in sorted(test_results, key=lambda t: t.created_at, reverse=True):
            test_rows.append(
                [
                    TEST_TYPE_LABELS.get(t.test_type, t.test_type),
                    t.column_a,
                    t.column_b,
                    f"{t.statistic:.4f}",
                    f"{t.p_value:.4f}",
                    # escape() — conclusion embeds CSV column names verbatim (see
                    # stats_tests.py), which are just as user-controlled as the
                    # filename above and hit the same Paragraph markup-parsing risk.
                    Paragraph(escape(t.conclusion), body_style),
                ]
            )
        test_table = Table(test_rows, hAlign="LEFT", repeatRows=1, colWidths=[55, 60, 60, 55, 50, 170])
        test_table.setStyle(_table_style())
        story.append(test_table)

    # --- Baseline model runs (FR-8, FR-9) ---
    story.append(Paragraph("Baseline Model", heading_style))
    if not model_runs:
        story.append(Paragraph("No baseline model has been trained on this dataset yet.", body_style))
    else:
        model_rows = [["Target", "Type", "Algorithm", "Metrics", "Strongest Predictors"]]
        for run in sorted(model_runs, key=lambda r: r.created_at, reverse=True):
            sorted_importance = sort_feature_importance(run.feature_importance)
            summary = describe_feature_importance(sorted_importance, run.target_column)
            model_rows.append(
                [
                    run.target_column,
                    MODEL_TYPE_LABELS.get(run.model_type, run.model_type),
                    run.algorithm,
                    # Paragraph, not a plain string — a classification run's
                    # "Accuracy=…, Precision=…, Recall=…, F1=…" is too long for
                    # a fixed column width and a plain Table cell doesn't wrap,
                    # it just overflows and overlaps the next column's text.
                    Paragraph(_format_metrics(run.metrics), body_style),
                    # escape() — target/feature column names are user-controlled
                    # (from the CSV's own headers), same Paragraph markup risk
                    # as the test conclusions above.
                    Paragraph(escape(summary), body_style),
                ]
            )
        model_table = Table(model_rows, hAlign="LEFT", repeatRows=1, colWidths=[55, 60, 65, 130, 135])
        model_table.setStyle(_table_style())
        story.append(model_table)

    doc.build(story)
    return buffer.getvalue()
