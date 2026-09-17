from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PDF_PATH = ROOT / "docs/membresia-cambios-2026-08-14.pdf"


def build_pdf() -> None:
    try:
        from reportlab.lib import colors
        from reportlab.lib.enums import TA_LEFT
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import cm
        from reportlab.platypus import PageBreak, Paragraph, Preformatted, SimpleDocTemplate, Spacer, Table, TableStyle
    except Exception as exc:
        raise SystemExit(f"reportlab_missing: {exc}")

    bg_page = colors.HexColor("#F4F8FB")
    navy = colors.HexColor("#0E2338")
    cyan = colors.HexColor("#27B7D3")
    cyan_soft = colors.HexColor("#D9F5FA")
    green = colors.HexColor("#16824E")
    amber = colors.HexColor("#B7791F")
    white = colors.white
    ink = colors.HexColor("#1F3347")
    line = colors.HexColor("#D6E2EA")

    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="HeroKicker", fontName="Helvetica-Bold", fontSize=10, leading=12, textColor=white))
    styles.add(ParagraphStyle(name="HeroTitle", fontName="Helvetica-Bold", fontSize=22, leading=26, textColor=white))
    styles.add(ParagraphStyle(name="HeroBody", fontName="Helvetica", fontSize=10.5, leading=14, textColor=white))
    styles.add(ParagraphStyle(name="Sec", fontName="Helvetica-Bold", fontSize=14, leading=18, textColor=ink, spaceAfter=8, spaceBefore=8))
    styles.add(ParagraphStyle(name="Sub", fontName="Helvetica-Bold", fontSize=11.2, leading=14, textColor=ink, spaceAfter=5, spaceBefore=6))
    styles.add(ParagraphStyle(name="BodyEs", fontName="Helvetica", fontSize=9.7, leading=13, textColor=ink, alignment=TA_LEFT))
    styles.add(ParagraphStyle(name="SmallEs", fontName="Helvetica", fontSize=8.8, leading=11, textColor=ink))
    styles.add(ParagraphStyle(name="Badge", fontName="Helvetica-Bold", fontSize=8.8, leading=11, textColor=white, alignment=1))

    def bullets(items: list[str]) -> str:
        return "<br/>".join(f"• {item}" for item in items)

    def badge(text: str, color) -> Table:
        return Table(
            [[Paragraph(text, styles["Badge"])]],
            colWidths=[2.9 * cm],
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

    def info_block(label: str, color, content: str) -> Table:
        return Table(
            [[badge(label, color), Paragraph(content, styles["SmallEs"])]],
            colWidths=[3.2 * cm, 14.1 * cm],
            style=TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), white),
                    ("BOX", (0, 0), (-1, -1), 0.6, line),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 10),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                    ("TOPPADDING", (0, 0), (-1, -1), 10),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                ]
            ),
        )

    def diagram_block(title: str, art: str) -> Table:
        return Table(
            [[Paragraph(f"<b>{title}</b>", styles["SmallEs"])], [Preformatted(art, styles["SmallEs"])]],
            colWidths=[17.3 * cm],
            style=TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), white),
                    ("BOX", (0, 0), (-1, -1), 0.6, line),
                    ("LEFTPADDING", (0, 0), (-1, -1), 10),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                    ("TOPPADDING", (0, 0), (-1, -1), 10),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                ]
            ),
        )

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
            Paragraph("DOCUMENTACION FUNCIONAL", styles["HeroKicker"]),
            Paragraph("Cambios de<br/>Membresia", styles["HeroTitle"]),
            Paragraph(
                "Fecha del documento: 14 de agosto de 2026<br/>"
                "Ultima actualizacion: 15 de agosto de 2026<br/>"
                "Alcance: frontend, backend, checkout, reglas de acceso y membresia familiar.",
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

    summary = Table(
        [[
            Paragraph("<font color='#16824E'><b>Frontend</b></font><br/><font size='16'>Actualizado</font>", styles["BodyEs"]),
            Paragraph("<font color='#16824E'><b>Backend</b></font><br/><font size='16'>Conectado</font>", styles["BodyEs"]),
            Paragraph("<font color='#27B7D3'><b>Checkout</b></font><br/><font size='16'>Stripe</font>", styles["BodyEs"]),
            Paragraph("<font color='#B7791F'><b>Familiar</b></font><br/><font size='16'>Operativo</font>", styles["BodyEs"]),
        ]],
        colWidths=[4.5 * cm, 4.5 * cm, 4.5 * cm, 4.6 * cm],
        style=TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), white),
                ("BOX", (0, 0), (-1, -1), 0.6, line),
                ("GRID", (0, 0), (-1, -1), 0.6, line),
                ("LEFTPADDING", (0, 0), (-1, -1), 12),
                ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ]
        ),
    )
    story.append(summary)
    story.append(Spacer(1, 12))

    story.append(Paragraph("1. Objetivo y alcance", styles["Sec"]))
    story.append(
        Paragraph(
            "La actualizacion de membresia se realizo para convertir la seccion de planes en un flujo funcional. La app ahora consulta la suscripcion real del usuario, muestra el plan activo, aplica reglas de acceso por plan, permite iniciar checkout para planes premium y habilita administracion familiar cuando el plan es compatible.",
            styles["BodyEs"],
        )
    )
    story.append(Spacer(1, 8))

    story.append(Paragraph("2. Estado actual del modulo", styles["Sec"]))
    story.append(
        info_block(
            "FRONTEND",
            green,
            bullets(
                [
                    "La pantalla principal carga planes y suscripcion desde backend.",
                    "Muestra plan activo, vigencia, metodo de pago y limite de miembros.",
                    "Incluye selector mensual o anual y acceso a checkout.",
                    "Presenta funciones activas y bloqueadas segun el plan.",
                ]
            ),
        )
    )
    story.append(Spacer(1, 8))
    story.append(
        info_block(
            "BACKEND",
            green,
            bullets(
                [
                    "Expone planes, suscripcion, checkout y familia.",
                    "Valida plan activo, duplicados y limite de miembros.",
                    "Calcula distancia aproximada entre titular y miembros.",
                    "Mantiene rutas de webhook para actualizacion de estado.",
                ]
            ),
        )
    )
    story.append(Spacer(1, 8))
    story.append(
        info_block(
            "PENDIENTES",
            amber,
            bullets(
                [
                    "La experiencia visible de pago en la app esta enfocada en Stripe.",
                    "La cancelacion desde la app sigue sin endpoint funcional en backend.",
                    "El funcionamiento final depende de credenciales y tablas desplegadas correctamente.",
                ]
            ),
        )
    )

    story.append(PageBreak())

    story.append(Paragraph("3. Apartados cambiados", styles["Sec"]))
    story.append(
        Paragraph(
            bullets(
                [
                    "Encabezado principal y resumen del plan actual.",
                    "Selector de modalidad mensual o anual.",
                    "Tarjetas visuales de planes.",
                    "Modal de pago previo al checkout.",
                    "Control de funciones desbloqueadas por plan.",
                    "Entrada a la pantalla de administracion familiar.",
                    "Listado real de miembros familiares.",
                    "Alta y baja de miembros familiares.",
                    "Servicio de integracion con backend.",
                    "Reglas de negocio de checkout y plan familiar.",
                ]
            ),
            styles["BodyEs"],
        )
    )

    story.append(Paragraph("4. Archivos impactados", styles["Sec"]))
    story.append(
        Paragraph(
            "Frontend:<br/>"
            "• frontend/app/subscription/index.tsx<br/>"
            "• frontend/app/subscription/manage.tsx<br/>"
            "• frontend/app/subscription/_services/subscriptionService.ts<br/>"
            "• frontend/app/subscription/_types.ts<br/>"
            "• frontend/app/subscription/_utils/planAccess.ts<br/>"
            "• frontend/app/subscription/_components/PlanCard.tsx<br/>"
            "• frontend/app/subscription/_components/BillingToggle.tsx<br/>"
            "• frontend/app/subscription/_components/StripePaymentSheet.tsx<br/>"
            "• frontend/app/subscription/_components/PaymentMethodSheet.tsx<br/>"
            "• frontend/app/subscription/_components/FeatureAccessCard.tsx<br/>"
            "• frontend/app/subscription/_components/MemberListItem.tsx<br/><br/>"
            "Backend:<br/>"
            "• backend/app/features/payments/router.py<br/>"
            "• backend/app/features/payments/service.py<br/>"
            "• backend/app/features/payments/schemas.py",
            styles["BodyEs"],
        )
    )

    story.append(Paragraph("5. Diagramas funcionales", styles["Sec"]))
    story.append(
        diagram_block(
            "Diagrama 1. Flujo general de suscripcion",
            """Usuario
  |
  v
Pantalla de suscripcion
  |
  +--> GET /payments/plans
  |
  +--> GET /payments/subscription
  |
  v
Plan activo + funciones desbloqueadas
  |
  +--> free / edu -> sin checkout
  |
  +--> safe / guard
          |
          v
      Seleccion mensual o anual
          |
          v
      Hoja de pago
          |
          v
      POST /payments/checkout
          |
          v
      Stripe Checkout""",
        )
    )
    story.append(Spacer(1, 8))
    story.append(
        diagram_block(
            "Diagrama 2. Flujo de membresia familiar",
            """Usuario con plan compatible
  |
  v
Pantalla Administrar membresias
  |
  +--> GET /payments/subscription
  |
  +--> Validacion de plan
  |
  +--> GET /payments/family-members
  |
  +--> POST /payments/family-members
  |
  +--> DELETE /payments/family-members/{member_user_id}""",
        )
    )

    story.append(PageBreak())

    story.append(Paragraph("6. Aclaraciones operativas", styles["Sec"]))
    story.append(Paragraph("Proveedor de pago visible en app", styles["Sub"]))
    story.append(
        Paragraph(
            "La experiencia mostrada al usuario esta enfocada actualmente en Stripe. Esto significa que el checkout visible, los textos de continuidad del cobro y la interaccion principal de compra se presentan alrededor de ese proveedor.",
            styles["BodyEs"],
        )
    )
    story.append(Paragraph("Cancelacion desde la app", styles["Sub"]))
    story.append(
        Paragraph(
            "La app ya puede consultar el plan activo e iniciar una compra, pero todavia no cuenta con un endpoint backend operativo para cancelar la suscripcion directamente desde la interfaz. Por eso el flujo de cancelacion sigue considerandose pendiente.",
            styles["BodyEs"],
        )
    )
    story.append(Paragraph("Dependencia de credenciales y despliegue", styles["Sub"]))
    story.append(
        Paragraph(
            "El funcionamiento productivo depende de credenciales de pago validas, tablas de suscripcion y familia correctamente desplegadas, y una configuracion consistente entre frontend, backend y proveedor de pago. La logica ya existe, pero el resultado final en produccion depende de esa infraestructura.",
            styles["BodyEs"],
        )
    )

    story.append(Paragraph("7. Conclusion", styles["Sec"]))
    story.append(
        Paragraph(
            "La membresia deja de ser una presentacion visual de planes y pasa a operar como un modulo funcional conectado a backend. Con este cambio ya existe lectura real de suscripcion, reglas de acceso por plan, inicio de checkout y administracion familiar bajo validaciones de negocio.",
            styles["BodyEs"],
        )
    )

    def paint_bg(canvas, _doc):
        width, height = A4
        canvas.saveState()
        canvas.setFillColor(bg_page)
        canvas.rect(0, 0, width, height, stroke=0, fill=1)
        canvas.setFillColor(cyan_soft)
        canvas.circle(width - 18, height - 40, 92, stroke=0, fill=1)
        canvas.setFillColor(colors.HexColor("#EAFBFD"))
        canvas.circle(28, 100, 65, stroke=0, fill=1)
        canvas.restoreState()

    doc.build(story, onFirstPage=paint_bg, onLaterPages=paint_bg)


if __name__ == "__main__":
    build_pdf()
    print(PDF_PATH.relative_to(ROOT).as_posix())
