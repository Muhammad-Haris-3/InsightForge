"""PDF summary export: quality report + EDA highlights + test results (FR-7)."""

import io
from datetime import datetime, timezone
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.models import ColumnProfile, Dataset, TestResult
from app.services.eda import EdaPayload

HEADER_BG = colors.HexColor("#18181b")  # zinc-900
ROW_ALT_BG = colors.HexColor("#f4f4f5")  # zinc-100
BORDER_COLOR = colors.HexColor("#d4d4d8")  # zinc-300

TEST_TYPE_LABELS = {"t_test": "t-test", "chi_square": "Chi-square", "anova": "ANOVA"}


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


def generate_report_pdf(
    dataset: Dataset,
    columns: list[ColumnProfile],
    eda: EdaPayload,
    test_results: list[TestResult],
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
                col.column_name,
                col.data_type,
                missing,
                str(col.unique_count),
                str(col.outlier_count) if col.outlier_count is not None else "-",
                _column_summary(col),
            ]
        )
    quality_table = Table(quality_rows, hAlign="LEFT", repeatRows=1)
    quality_table.setStyle(_table_style())
    story.append(quality_table)

    # --- EDA highlight: correlation matrix (FR-4) ---
    story.append(Paragraph("EDA Highlights — Correlation Matrix", heading_style))
    if eda.correlation_matrix is None:
        story.append(Paragraph("Fewer than 2 numeric columns — no correlation matrix to show.", body_style))
    else:
        corr = eda.correlation_matrix
        corr_rows = [[""] + corr.columns]
        for row_name, row_values in zip(corr.columns, corr.matrix, strict=True):
            corr_rows.append([row_name] + [f"{v:.2f}" if v is not None else "-" for v in row_values])
        corr_table = Table(corr_rows, hAlign="LEFT")
        corr_table.setStyle(_table_style())
        story.append(corr_table)

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

    doc.build(story)
    return buffer.getvalue()
