from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
JSON_PATH = ROOT / "docs/bluetooth_audit_results.json"
PDF_PATH = ROOT / "docs/bluetooth_audit_resultados_es.pdf"


def load_report() -> dict:
    return json.loads(JSON_PATH.read_text(encoding="utf-8"))


def get_error_actions(checks: list[dict]) -> list[dict]:
    index = {check["key"]: check for check in checks}
    actions: list[dict] = []

    if index["native_strategy_mesh"]["status"] == "FAIL":
        actions.append(
            {
                "prioridad": "Alta",
                "titulo": "Cambiar estrategia nativa a P2P_CLUSTER",
                "descripcion": "El módulo nativo sigue en P2P_POINT_TO_POINT, lo que limita el alcance a un flujo 1 a 1 y bloquea el mesh real.",
                "archivo": "frontend/plugins/with-nearby-connections.js",
            }
        )

    if index["single_connection_native"]["status"] == "FAIL":
        actions.append(
            {
                "prioridad": "Alta",
                "titulo": "Reemplazar conexión única por mapa de peers",
                "descripcion": "El nativo aún usa connectedEndpointId único; necesitamos múltiples conexiones simultáneas para soportar saltos y fan-out.",
                "archivo": "frontend/plugins/with-nearby-connections.js",
            }
        )

    if index["targeted_send_real"]["status"] == "FAIL":
        actions.append(
            {
                "prioridad": "Alta",
                "titulo": "Hacer envío dirigido real por endpoint",
                "descripcion": "La capa Android ignora el endpoint solicitado y envía al peer implícito actual; esto impide un router mesh correcto.",
                "archivo": "frontend/app/local-chat/_services/NearbyTransport.android.ts",
            }
        )

    if index["mesh_router_implemented"]["status"] == "FAIL":
        actions.append(
            {
                "prioridad": "Alta",
                "titulo": "Implementar meshRouter.ts",
                "descripcion": "No existe la capa de ruteo con TTL, deduplicación y split horizon, que es el corazón del mesh multi-salto.",
                "archivo": "frontend/app/local-chat/_services/meshRouter.ts",
            }
        )

    if index["mesh_harness_present"]["status"] == "FAIL":
        actions.append(
            {
                "prioridad": "Media",
                "titulo": "Agregar harness de simulación y pruebas multi-salto",
                "descripcion": "No se encontró simulación automatizada de topologías A-B-C ni validación de TTL, dedup y split horizon.",
                "archivo": "frontend/app/local-chat/_services/",
            }
        )

    if index["roadmap_still_pending"]["status"] == "WARN" or index["spec_explicit_gaps"]["status"] == "WARN":
        actions.append(
            {
                "prioridad": "Media",
                "titulo": "Alinear documentación con el estado real del código",
                "descripcion": "La documentación sigue tratando mesh como pendiente; al cerrar código, hay que actualizar roadmap y specs para evitar confusión de estatus.",
                "archivo": "docs/RoadMap.md y docs/specs_july05/",
            }
        )

    return actions


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
        from reportlab.platypus import (
            KeepTogether,
            Paragraph,
            SimpleDocTemplate,
            Spacer,
            Table,
            TableStyle,
        )
    except Exception as exc:
        raise SystemExit(f"reportlab_missing: {exc}")

    report = load_report()
    checks = report["checks"]
    counts = report["counts"]
    verdict = report["verdict"]["color"]
    summary = report["verdict"]["summary"]
    actions = get_error_actions(checks)

    bg_page = colors.HexColor("#F3F8FB")
    navy = colors.HexColor("#0E2A47")
    cyan = colors.HexColor("#2CA6A4")
    sky = colors.HexColor("#D7EEF0")
    ink = colors.HexColor("#16324A")
    muted = colors.HexColor("#607489")
    line = colors.HexColor("#D9E4EC")
    pass_color = colors.HexColor("#1B8F5A")
    fail_color = colors.HexColor("#D1492E")
    warn_color = colors.HexColor("#D08A00")
    verdict_color = {"VERDE": pass_color, "NARANJA": warn_color, "ROJO": fail_color}.get(verdict, cyan)

    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="HeroKicker", fontName="Helvetica-Bold", fontSize=10, leading=12, textColor=colors.white))
    styles.add(ParagraphStyle(name="HeroTitle", fontName="Helvetica-Bold", fontSize=22, leading=26, textColor=colors.white))
    styles.add(ParagraphStyle(name="HeroBody", fontName="Helvetica", fontSize=10.5, leading=14, textColor=colors.white))
    styles.add(ParagraphStyle(name="Sec", fontName="Helvetica-Bold", fontSize=14, leading=18, textColor=ink, spaceAfter=8, spaceBefore=8))
    styles.add(ParagraphStyle(name="BodyEs", fontName="Helvetica", fontSize=10.2, leading=14, textColor=ink, alignment=TA_LEFT))
    styles.add(ParagraphStyle(name="SmallEs", fontName="Helvetica", fontSize=8.8, leading=11, textColor=ink))
    styles.add(ParagraphStyle(name="MutedEs", fontName="Helvetica", fontSize=9.2, leading=12, textColor=muted))
    styles.add(ParagraphStyle(name="Badge", fontName="Helvetica-Bold", fontSize=9, leading=11, textColor=colors.white, alignment=1))

    def make_badge(text: str, bg) -> Table:
        return Table(
            [[Paragraph(text, styles["Badge"])]],
            colWidths=[2.1 * cm],
            style=TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), bg),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ]
            ),
        )

    def build_bar_chart() -> Drawing:
        drawing = Drawing(260, 170)
        chart = VerticalBarChart()
        chart.x = 30
        chart.y = 35
        chart.height = 100
        chart.width = 200
        chart.data = [[counts["PASS"], counts["FAIL"], counts["WARN"]]]
        chart.categoryAxis.categoryNames = ["PASS", "FAIL", "WARN"]
        chart.valueAxis.valueMin = 0
        chart.valueAxis.valueMax = max(counts.values()) + 2
        chart.valueAxis.valueStep = 2
        chart.bars[0].fillColor = cyan
        chart.barLabels.nudge = 8
        chart.barLabelFormat = "%d"
        chart.barLabels.fontName = "Helvetica-Bold"
        chart.barLabels.fontSize = 9
        chart.categoryAxis.labels.fontName = "Helvetica"
        chart.categoryAxis.labels.fontSize = 8
        chart.valueAxis.labels.fontName = "Helvetica"
        chart.valueAxis.labels.fontSize = 8
        drawing.add(chart)
        drawing.add(String(30, 150, "Distribución de hallazgos", fontName="Helvetica-Bold", fontSize=11, fillColor=ink))
        return drawing

    def build_pie_chart() -> Drawing:
        total = max(sum(counts.values()), 1)
        drawing = Drawing(220, 170)
        pie = Pie()
        pie.x = 45
        pie.y = 20
        pie.width = 110
        pie.height = 110
        pie.data = [counts["PASS"], counts["FAIL"], counts["WARN"]]
        pie.labels = [
            f"PASS {round(counts['PASS'] * 100 / total)}%",
            f"FAIL {round(counts['FAIL'] * 100 / total)}%",
            f"WARN {round(counts['WARN'] * 100 / total)}%",
        ]
        pie.slices[0].fillColor = pass_color
        pie.slices[1].fillColor = fail_color
        pie.slices[2].fillColor = warn_color
        pie.slices.strokeWidth = 0.5
        pie.slices.strokeColor = colors.white
        pie.sideLabels = True
        drawing.add(pie)
        drawing.add(String(35, 145, "Peso relativo de resultados", fontName="Helvetica-Bold", fontSize=11, fillColor=ink))
        return drawing

    def status_bg(status: str):
        return {"PASS": pass_color, "FAIL": fail_color, "WARN": warn_color}.get(status, muted)

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
            Paragraph("REPORTE TECNICO", styles["HeroKicker"]),
            Paragraph("Bluetooth<br/>Auditoría Exhaustiva", styles["HeroTitle"]),
            Paragraph(
                "Fecha: 6 de agosto de 2026<br/>"
                f"Resultado general: <b>{verdict}</b><br/>"
                f"{summary}",
                styles["HeroBody"],
            ),
        ]],
        colWidths=[18.1 * cm],
        style=TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), navy),
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
            Paragraph(f"<font color='{pass_color}'><b>PASS</b></font><br/><font size='18'>{counts['PASS']}</font>", styles["BodyEs"]),
            Paragraph(f"<font color='{fail_color}'><b>FAIL</b></font><br/><font size='18'>{counts['FAIL']}</font>", styles["BodyEs"]),
            Paragraph(f"<font color='{warn_color}'><b>WARN</b></font><br/><font size='18'>{counts['WARN']}</font>", styles["BodyEs"]),
            Paragraph(f"<font color='{verdict_color}'><b>VEREDICTO</b></font><br/><font size='18'>{verdict}</font>", styles["BodyEs"]),
        ]],
        colWidths=[4.5 * cm, 4.5 * cm, 4.5 * cm, 4.6 * cm],
        style=TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                ("BOX", (0, 0), (-1, -1), 0.6, line),
                ("GRID", (0, 0), (-1, -1), 0.6, line),
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
            "La auditoría confirma que Bluetooth sí existe como funcionalidad real en la app base: hay pantallas, provider compartido, persistencia local, permisos Android y puente nativo con Nearby Connections. "
            "El punto débil es que el alcance mesh multi-salto todavía no está cerrado, porque el código actual sigue orientado a una conexión única y no muestra un router mesh dedicado.",
            styles["BodyEs"],
        )
    )
    story.append(Spacer(1, 10))

    graficas = Table(
        [[build_bar_chart(), build_pie_chart()]],
        colWidths=[9.4 * cm, 8.7 * cm],
        style=TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                ("BOX", (0, 0), (-1, -1), 0.6, line),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        ),
    )
    story.append(graficas)
    story.append(Spacer(1, 12))

    story.append(Paragraph("Errores que Debemos Corregir", styles["Sec"]))
    for action in actions:
        pri_color = fail_color if action["prioridad"] == "Alta" else warn_color
        block = Table(
            [[
                make_badge(action["prioridad"], pri_color),
                Paragraph(
                    f"<b>{action['titulo']}</b><br/>"
                    f"{action['descripcion']}<br/><br/>"
                    f"<font color='{muted}'>Archivo clave:</font> {action['archivo']}",
                    styles["SmallEs"],
                ),
            ]],
            colWidths=[2.5 * cm, 14.8 * cm],
            style=TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                    ("BOX", (0, 0), (-1, -1), 0.6, line),
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

    story.append(Paragraph("Resultados por Check", styles["Sec"]))
    for check in checks:
        evidence = "<br/>".join(f"• {item}" for item in check["evidence"])
        block = Table(
            [[
                make_badge(check["status"], status_bg(check["status"])),
                Paragraph(
                    f"<b>{check['title']}</b><br/>"
                    f"{check['detail']}<br/><br/>"
                    f"<font color='{muted}'>Evidencia:</font><br/>{evidence}",
                    styles["SmallEs"],
                ),
            ]],
            colWidths=[2.5 * cm, 14.8 * cm],
            style=TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                    ("BOX", (0, 0), (-1, -1), 0.6, line),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 10),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                    ("TOPPADDING", (0, 0), (-1, -1), 10),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                ]
            ),
        )
        story.append(KeepTogether(block))
        story.append(Spacer(1, 7))

    story.append(Paragraph("Conclusión Final", styles["Sec"]))
    story.append(
        Paragraph(
            f"El veredicto final es <b><font color='{verdict_color}'>{verdict}</font></b>. "
            "Bluetooth puede defenderse como una funcionalidad real y con avance serio dentro de la app base, pero todavía no puede presentarse como mesh completo en su totalidad. "
            "Las correcciones prioritarias están en la estrategia nativa, multi-peer, envío dirigido y router mesh.",
            styles["BodyEs"],
        )
    )

    def paint_background(canvas, _doc):
        width, height = A4
        canvas.saveState()
        canvas.setFillColor(bg_page)
        canvas.rect(0, 0, width, height, stroke=0, fill=1)
        canvas.setFillColor(sky)
        canvas.circle(width - 10, height - 30, 95, stroke=0, fill=1)
        canvas.setFillColor(colors.HexColor("#E1F4F3"))
        canvas.circle(30, 100, 70, stroke=0, fill=1)
        canvas.restoreState()

    doc.build(story, onFirstPage=paint_background, onLaterPages=paint_background)


if __name__ == "__main__":
    build_pdf()
    print(PDF_PATH.relative_to(ROOT).as_posix())
