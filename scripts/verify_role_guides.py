#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
ROLE_DIRECTORY = ROOT / "docs" / "roles"
PDF_DIRECTORY = ROOT / "output" / "pdf" / "roles"
VERSION = "1.11.0"
ROLES = ["kasse", "flight-line", "flight-director", "fids", "administration"]
FORBIDDEN = ["Flight Line Assist", "Flight Line Supervisor", "BOOTSTRAP_TOKEN", "000000"]


def main() -> None:
    for role in ROLES:
        markdown_path = ROLE_DIRECTORY / f"{role}.md"
        markdown = markdown_path.read_text(encoding="utf-8")
        if f"Version {VERSION}" not in markdown:
            raise ValueError(f"{markdown_path}: Version {VERSION} fehlt")
        if any(value in markdown for value in FORBIDDEN):
            raise ValueError(f"{markdown_path}: veralteter oder sensitiver Begriff")
        if len(re.findall(r"^\d+\. ", markdown, flags=re.MULTILINE)) not in range(4, 7):
            raise ValueError(f"{markdown_path}: vier bis sechs Kernschritte erforderlich")
        image_match = re.search(r"!\[[^\]]+\]\(([^)]+)\)", markdown)
        if not image_match or not (markdown_path.parent / image_match.group(1)).exists():
            raise ValueError(f"{markdown_path}: Screenshot fehlt")

        pdf_path = PDF_DIRECTORY / f"einweisung-{role}-v{VERSION}.pdf"
        reader = PdfReader(str(pdf_path))
        maximum_pages = 2 if role == "administration" else 1
        if not 1 <= len(reader.pages) <= maximum_pages:
            raise ValueError(f"{pdf_path}: unzulässige Seitenzahl {len(reader.pages)}")
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
        required = [VERSION, "Kernschritte", "Stopp / Hilfe holen", "Wesentliche Invarianten"]
        if any(value not in text for value in required):
            raise ValueError(f"{pdf_path}: Pflichttext fehlt")
        if any(value in text for value in FORBIDDEN):
            raise ValueError(f"{pdf_path}: veralteter oder sensitiver Begriff")
        image_count = 0
        for page in reader.pages:
            resources = page.get("/Resources", {})
            xobjects = resources.get("/XObject", {})
            for item in xobjects.values():
                if item.get_object().get("/Subtype") == "/Image":
                    image_count += 1
        if image_count < 1:
            raise ValueError(f"{pdf_path}: kein eingebetteter Screenshot")
    print(f"OK: {len(ROLES)} Rollenblätter, PDFs, Bilder und Seitenzahlen für {VERSION}")


if __name__ == "__main__":
    main()
