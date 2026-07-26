#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import KeepInFrame, Paragraph, Spacer

ROOT = Path(__file__).resolve().parents[1]
ROLE_DIRECTORY = ROOT / "docs" / "roles"
OUTPUT_DIRECTORY = ROOT / "output" / "pdf" / "roles"
VERSION = "1.10.0"
GUIDES = {
    "kasse": [(0.13, 0.18), (0.30, 0.13), (0.40, 0.18), (0.36, 0.31), (0.77, 0.34)],
    "flight-line": [(0.08, 0.12), (0.10, 0.31), (0.18, 0.31), (0.26, 0.31), (0.14, 0.57)],
    "flight-director": [(0.08, 0.16), (0.42, 0.17), (0.70, 0.17), (0.48, 0.52), (0.83, 0.52)],
    "fids": [(0.05, 0.08), (0.45, 0.22), (0.94, 0.08), (0.56, 0.48), (0.88, 0.83)],
    "administration": [(0.10, 0.09), (0.29, 0.09), (0.48, 0.09), (0.67, 0.09), (0.86, 0.09)],
}


def section(markdown: str, name: str) -> str:
    match = re.search(
        rf"^## {re.escape(name)}\s*\n(.*?)(?=^## |\Z)", markdown, flags=re.MULTILINE | re.DOTALL
    )
    if not match:
        raise ValueError(f"Abschnitt {name!r} fehlt")
    return match.group(1).strip()


def compact(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip()).replace("**", "").replace("`", "")


def bullets(text: str) -> list[str]:
    return [compact(value) for value in re.findall(r"^- (.+)$", text, flags=re.MULTILINE)]


def numbered(text: str) -> list[str]:
    return [compact(value) for value in re.findall(r"^\d+\. (.+)$", text, flags=re.MULTILINE)]


def register_font() -> str:
    candidates = [
        Path("C:/Windows/Fonts/arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            pdfmetrics.registerFont(TTFont("RoleGuideSans", str(candidate)))
            return "RoleGuideSans"
    return "Helvetica"


def paragraph(text: str, style: ParagraphStyle) -> Paragraph:
    safe = (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("→", "&#8594;")
    )
    return Paragraph(safe, style)


def render_guide(slug: str, callouts: list[tuple[float, float]], font_name: str) -> None:
    source = ROLE_DIRECTORY / f"{slug}.md"
    markdown = source.read_text(encoding="utf-8")
    title_match = re.search(r"^# (.+)$", markdown, flags=re.MULTILINE)
    version_match = re.search(rf"^Version {re.escape(VERSION)} · Ziel: (.+)$", markdown, flags=re.MULTILINE)
    image_match = re.search(r"!\[[^\]]+\]\(([^)]+)\)", markdown)
    if not title_match or not version_match or not image_match:
        raise ValueError(f"{source}: Titel, Version/Ziel oder Bild fehlt")

    steps = numbered(section(markdown, "Kernschritte"))
    stop_items = bullets(section(markdown, "Stopp/Hilfe holen"))
    invariants = bullets(section(markdown, "Invarianten"))
    if not 4 <= len(steps) <= 6:
        raise ValueError(f"{source}: vier bis sechs Kernschritte erforderlich")
    image_path = source.parent / image_match.group(1)
    if not image_path.exists():
        raise ValueError(f"{source}: Bild fehlt: {image_path}")

    OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    output = OUTPUT_DIRECTORY / f"einweisung-{slug}-v{VERSION}.pdf"
    page_width, page_height = landscape(A4)
    canvas = Canvas(str(output), pagesize=(page_width, page_height), invariant=1)
    canvas.setTitle(title_match.group(1))
    canvas.setAuthor("Rundflug-Leitstand")
    canvas.setSubject(f"Rollenblatt Release {VERSION}")

    dark = colors.HexColor("#102A43")
    blue = colors.HexColor("#0967D2")
    pale_blue = colors.HexColor("#E6F0FF")
    pale_red = colors.HexColor("#FFF1F0")
    gray = colors.HexColor("#52606D")

    canvas.setFillColor(dark)
    canvas.rect(0, page_height - 54, page_width, 54, stroke=0, fill=1)
    canvas.setFillColor(colors.white)
    canvas.setFont(font_name, 20)
    canvas.drawString(24, page_height - 34, title_match.group(1))
    canvas.setFont(font_name, 8)
    canvas.drawRightString(page_width - 24, page_height - 31, f"Rundflug-Leitstand · {VERSION}")

    left_x, left_width = 24, 500
    image_top = page_height - 72
    image_reader = ImageReader(str(image_path))
    image_width, image_height = image_reader.getSize()
    scale = min(left_width / image_width, 326 / image_height)
    draw_width, draw_height = image_width * scale, image_height * scale
    image_y = image_top - draw_height
    canvas.drawImage(
        image_reader,
        left_x,
        image_y,
        width=draw_width,
        height=draw_height,
        preserveAspectRatio=True,
        mask="auto",
    )
    canvas.setStrokeColor(colors.HexColor("#CBD5E1"))
    canvas.rect(left_x, image_y, draw_width, draw_height, stroke=1, fill=0)

    for index, (normalized_x, normalized_y) in enumerate(callouts[: len(steps)], start=1):
        marker_x = left_x + normalized_x * draw_width
        marker_y = image_y + (1 - normalized_y) * draw_height
        canvas.setFillColor(blue)
        canvas.circle(marker_x, marker_y, 10, stroke=0, fill=1)
        canvas.setFillColor(colors.white)
        canvas.setFont(font_name, 9)
        canvas.drawCentredString(marker_x, marker_y - 3, str(index))

    flow_y = 72
    canvas.setFillColor(dark)
    canvas.setFont(font_name, 10)
    canvas.drawString(left_x, flow_y + 46, "Normalfall")
    flow = compact(section(markdown, "Normalfall")).split(" → ")
    box_width = (left_width - (len(flow) - 1) * 12) / len(flow)
    for index, label in enumerate(flow):
        x = left_x + index * (box_width + 12)
        canvas.setFillColor(pale_blue)
        canvas.roundRect(x, flow_y, box_width, 34, 4, stroke=0, fill=1)
        canvas.setFillColor(dark)
        canvas.setFont(font_name, 7.4)
        canvas.drawCentredString(x + box_width / 2, flow_y + 13, label)
        if index < len(flow) - 1:
            canvas.setFillColor(blue)
            canvas.drawCentredString(x + box_width + 6, flow_y + 13, ">")

    styles = getSampleStyleSheet()
    body = ParagraphStyle(
        "Body",
        parent=styles["BodyText"],
        fontName=font_name,
        fontSize=8.3,
        leading=10.3,
        textColor=dark,
        alignment=TA_LEFT,
        spaceAfter=3,
    )
    heading = ParagraphStyle(
        "Heading",
        parent=body,
        fontSize=10.5,
        leading=12,
        textColor=blue,
        spaceBefore=4,
        spaceAfter=3,
    )
    small = ParagraphStyle(
        "Small",
        parent=body,
        fontSize=7.7,
        leading=9.2,
        leftIndent=8,
        firstLineIndent=-8,
    )
    right_x = 545
    right_width = page_width - right_x - 24
    story = [
        paragraph("Zweck", heading),
        paragraph(version_match.group(1), body),
        paragraph("Einstieg", heading),
        paragraph(compact(section(markdown, "Einstieg")), body),
        paragraph("Kernschritte", heading),
    ]
    story.extend(paragraph(f"{index}. {value}", small) for index, value in enumerate(steps, 1))
    story.extend([Spacer(1, 3), paragraph("Stopp / Hilfe holen", heading)])
    for value in stop_items:
        story.append(paragraph(f"• {value}", small))
    story.extend([Spacer(1, 3), paragraph("Wesentliche Invarianten", heading)])
    for value in invariants:
        story.append(paragraph(f"• {value}", small))
    text_frame = KeepInFrame(right_width, page_height - 96, story, mode="shrink")
    text_frame.wrapOn(canvas, right_width, page_height - 96)
    text_frame.drawOn(canvas, right_x, 40)

    canvas.setFillColor(pale_red)
    canvas.roundRect(left_x, 27, left_width, 28, 4, stroke=0, fill=1)
    canvas.setFillColor(colors.HexColor("#9B1C1C"))
    canvas.setFont(font_name, 7.4)
    canvas.drawString(
        left_x + 8,
        38,
        "Nur synthetische Daten · PINs, Codes und Secrets gehören nie in Einweisungsunterlagen.",
    )
    canvas.setFillColor(gray)
    canvas.setFont(font_name, 7)
    canvas.drawRightString(page_width - 24, 18, f"Seite 1/1 · Release {VERSION}")
    canvas.showPage()
    canvas.save()


def main() -> None:
    font_name = register_font()
    for slug, callouts in GUIDES.items():
        render_guide(slug, callouts, font_name)
    print(f"OK: {len(GUIDES)} Rollen-PDFs für Release {VERSION} erzeugt")


if __name__ == "__main__":
    main()
