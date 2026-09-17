from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PDF_PATH = ROOT / "docs/evaluacion_vesting_diseno.pdf"


def build_pdf() -> None:
    try:
        from reportlab.graphics.charts.barcharts import VerticalBarChart
        from reportlab.graphics.charts.piecharts import Pie
        from reportlab.graphics.shapes import Drawing, String
        from reportlab.lib import colors
        from reportlab.lib.enums import TA_LEFT
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import cm
        from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    except Exception as exc:
        raise SystemExit(f"reportlab_missing: {exc}")

    bg_page = colors.HexColor("#F7F6F2")
    dark = colors.HexColor("#1E293B")
    sand = colors.HexColor("#E9E2D0")
    cream = colors.HexColor("#FFFDF8")
    ink = colors.HexColor("#2C3A4B")
    muted = colors.HexColor("#667085")
    border = colors.HexColor("#DDD6C5")
    green = colors.HexColor("#1F8F55")
    orange = colors.HexColor("#D97706")
    red = colors.HexColor("#C2410C")

    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="HeroKicker", fontName="Helvetica-Bold", fontSize=10, leading=12, textColor=colors.white))
    styles.add(ParagraphStyle(name="HeroTitle", fontName="Helvetica-Bold", fontSize=22, leading=26, textColor=colors.white))
    styles.add(ParagraphStyle(name="HeroBody", fontName="Helvetica", fontSize=10.5, leading=14, textColor=colors.white))
    styles.add(ParagraphStyle(name="Sec", fontName="Helvetica-Bold", fontSize=14, leading=18, textColor=ink, spaceAfter=8, spaceBefore=8))
    styles.add(ParagraphStyle(name="BodyEs", fontName="Helvetica", fontSize=10.2, leading=14, textColor=ink, alignment=TA_LEFT))
    styles.add(ParagraphStyle(name="SmallEs", fontName="Helvetica", fontSize=8.8, leading=11, textColor=ink))
    styles.add(ParagraphStyle(name="Badge", fontName="Helvetica-Bold", fontSize=9, leading=11, textColor=colors.white, alignment=1))

    def badge(text: str, color) -> Table:
        return Table(
            [[Paragraph(text, styles["Badge"])]],
            colWidths=[2.2 * cm],
            style=TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), color),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ]
            ),
        )

    def bar_chart() -> Drawing:
        drawing = Drawing(250, 165)
        chart = VerticalBarChart()
        chart.x = 28
        chart.y = 30
        chart.height = 100
        chart.width = 185
        chart.data = [[0, 1, 3]]
        chart.categoryAxis.categoryNames = ["VERDE", "NARANJA", "ROJO"]
        chart.valueAxis.valueMin = 0
        chart.valueAxis.valueMax = 4
        chart.valueAxis.valueStep = 1
        chart.bars[0].fillColor = orange
        chart.barLabels.nudge = 8
        chart.barLabelFormat = "%d"
        chart.barLabels.fontName = "Helvetica-Bold"
        chart.barLabels.fontSize = 9
        chart.categoryAxis.labels.fontName = "Helvetica"
        chart.categoryAxis.labels.fontSize = 8
        chart.valueAxis.labels.fontName = "Helvetica"
        chart.valueAxis.labels.fontSize = 8
        drawing.add(chart)
        drawing.add(String(28, 145, "Señales encontradas en el repositorio", fontName="Helvetica-Bold", fontSize=11, fillColor=ink))
        return drawing

    def pie_chart() -> Drawing:
        drawing = Drawing(220, 165)
        pie = Pie()
        pie.x = 45
        pie.y = 22
        pie.width = 108
        pie.height = 108
        pie.data = [85, 15]
        pie.labels = ["Vacío documental 85%", "Mención indirecta 15%"]
        pie.slices[0].fillColor = red
        pie.slices[1].fillColor = orange
        pie.slices.strokeWidth = 0.5
        pie.slices.strokeColor = colors.white
        pie.sideLabels = True
        drawing.add(pie)
        drawing.add(String(35, 143, "Peso del hallazgo", fontName="Helvetica-Bold", fontSize=11, fillColor=ink))
        return drawing

    hallazgos = [
        {
            "prioridad": "Alta",
            "titulo": "No existe documento formal de vesting",
            "descripcion": "No se encontró un archivo dedicado a vesting, calendario de consolidación, cliff, porcentajes o términos societarios equivalentes.",
            "archivo": "No encontrado en docs/ ni archivos raíz auditados",
            "color": red,
        },
        {
            "prioridad": "Alta",
            "titulo": "No hay reglas operativas ni porcentajes definidos",
            "descripcion": "No aparecen participaciones, ventanas de consolidación, aceleración, recompra ni condiciones de salida para integrantes del proyecto.",
            "archivo": "No encontrado en documentación revisada",
            "color": red,
        },
        {
            "prioridad": "Media",
            "titulo": "Solo existe una mención indirecta a equity y división futura",
            "descripcion": "El repo menciona que equity, pago y división futura se definirían después, lo que indica reconocimiento del tema, pero no resolución.",
            "archivo": "docs/specs_june05/sprint.md",
            "color": orange,
        },
        {
            "prioridad": "Media",
            "titulo": "Contratos y membresías no equivalen a vesting",
            "descripcion": "Las referencias encontradas a membresías y contratos operativos no sustituyen un acuerdo real de vesting o participación.",
            "archivo": "docs/specs_may20/diego.md y referencias operativas varias",
            "color": orange,
        },
    ]

    doc = SimpleDocTemplate(
        str(PDF_PATH),
        pagesize=A4,
        rightMargin=1.3 * cm,
        leftMargin=1.3 * cm,
        topMargin=1.0 * cm,
        bottomMargin=1.1 * cm,
    )

    story = []

    hero = Table(
        [[
            Paragraph("REPORTE DOCUMENTAL", styles["HeroKicker"]),
            Paragraph("Evaluación de<br/>Vesting", styles["HeroTitle"]),
            Paragraph(
                "Fecha: 6 de agosto de 2026<br/>"
                "Resultado general: <b>ROJO</b><br/>"
                "No existe un documento formal de vesting dentro del repositorio actual.",
                styles["HeroBody"],
            ),
        ]],
        colWidths=[18.1 * cm],
        style=TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), dark),
                ("LEFTPADDING", (0, 0), (-1, -1), 16),
                ("RIGHTPADDING", (0, 0), (-1, -1), 16),
                ("TOPPADDING", (0, 0), (-1, -1), 16),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 16),
            ]
        ),
    )
    story.append(hero)
    story.append(Spacer(1, 12))

    resumen = Table(
        [[
            Paragraph("<font color='#1F8F55'><b>VERDE</b></font><br/><font size='18'>0</font>", styles["BodyEs"]),
            Paragraph("<font color='#D97706'><b>NARANJA</b></font><br/><font size='18'>1</font>", styles["BodyEs"]),
            Paragraph("<font color='#C2410C'><b>ROJO</b></font><br/><font size='18'>3</font>", styles["BodyEs"]),
            Paragraph("<font color='#C2410C'><b>VEREDICTO</b></font><br/><font size='18'>ROJO</font>", styles["BodyEs"]),
        ]],
        colWidths=[4.5 * cm, 4.5 * cm, 4.5 * cm, 4.6 * cm],
        style=TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), cream),
                ("BOX", (0, 0), (-1, -1), 0.6, border),
                ("GRID", (0, 0), (-1, -1), 0.6, border),
                ("LEFTPADDING", (0, 0), (-1, -1), 12),
                ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ]
        ),
    )
    story.append(resumen)
    story.append(Spacer(1, 12))

    story.append(Paragraph("Resumen Ejecutivo", styles["Sec"]))
    story.append(
        Paragraph(
            "La revisión del repositorio no encontró un documento formal de vesting ni reglas completas de participación. "
            "Solo aparece una mención indirecta a equity, pago y división futura, lo que indica que el tema fue reconocido pero no desarrollado dentro del código o la documentación actual.",
            styles["BodyEs"],
        )
    )
    story.append(Spacer(1, 10))

    charts = Table(
        [[bar_chart(), pie_chart()]],
        colWidths=[9.4 * cm, 8.7 * cm],
        style=TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), cream),
                ("BOX", (0, 0), (-1, -1), 0.6, border),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        ),
    )
    story.append(charts)
    story.append(Spacer(1, 12))

    story.append(Paragraph("Qué Falta Corregir o Definir", styles["Sec"]))
    for item in hallazgos:
        block = Table(
            [[
                badge(item["prioridad"], item["color"]),
                Paragraph(
                    f"<b>{item['titulo']}</b><br/>"
                    f"{item['descripcion']}<br/><br/>"
                    f"<font color='{muted}'>Referencia:</font> {item['archivo']}",
                    styles["SmallEs"],
                ),
            ]],
            colWidths=[2.6 * cm, 14.7 * cm],
            style=TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), cream),
                    ("BOX", (0, 0), (-1, -1), 0.6, border),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 10),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                    ("TOPPADDING", (0, 0), (-1, -1), 10),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                ]
            ),
        )
        story.append(KeepTogether(block))
        story.append(Spacer(1, 8))

    story.append(Paragraph("Conclusión Final", styles["Sec"]))
    story.append(
        Paragraph(
            "El veredicto final es <b><font color='#C2410C'>ROJO</font></b>. "
            "Dentro del repositorio actual no existe evidencia suficiente para afirmar que vesting esté documentado o definido formalmente. "
            "Para cambiar este estatus, sería necesario crear un documento explícito con porcentajes, tiempos, cliff, condiciones de salida y reglas de consolidación.",
            styles["BodyEs"],
        )
    )

    def paint_bg(canvas, _doc):
        width, height = A4
        canvas.saveState()
        canvas.setFillColor(bg_page)
        canvas.rect(0, 0, width, height, stroke=0, fill=1)
        canvas.setFillColor(sand)
        canvas.circle(width - 15, height - 35, 92, stroke=0, fill=1)
        canvas.setFillColor(colors.HexColor("#F1EADB"))
        canvas.circle(25, 95, 68, stroke=0, fill=1)
        canvas.restoreState()

    doc.build(story, onFirstPage=paint_bg, onLaterPages=paint_bg)


if __name__ == "__main__":
    build_pdf()
    print(PDF_PATH.relative_to(ROOT).as_posix())
