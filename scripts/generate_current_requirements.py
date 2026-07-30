#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import io
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = "1.10.0"
BASE_YAML = ROOT / "docs/requirements/requirements-v1.4.yaml"
BASE_TRACE = ROOT / "docs/requirements/traceability.csv"
DELTA_SOURCES = sorted((ROOT / "scripts/data").glob("requirements-delta-*.json"))
CURRENT_YAML = ROOT / f"docs/requirements/requirements-v{VERSION}.yaml"
CURRENT_MD = ROOT / f"docs/requirements/requirements-v{VERSION}.md"
CURRENT_TRACE = ROOT / f"docs/requirements/traceability-v{VERSION}.csv"

RELEASE_REQUIREMENTS = [
    {
        "id": "V1100-REL-010",
        "section": "Release und Versionierung",
        "requirement": "Anwendung, Workspace-Pakete, /api/meta, Healthcheck, Backups, Requirements, Traceability, Rollenunterlagen und PDFs melden konsistent 1.10.0.",
        "module": "package.json packages/config apps/worker/src/index.ts apps/worker/src/backup.ts",
        "tests": "scripts/verify_requirements.py und npm run check",
    },
    {
        "id": "V1100-DOC-010",
        "section": "Dokumentationskonsistenz",
        "requirement": "Nur der aktuelle Katalog, gültige ADRs, Betriebsanleitungen, automatisierte Tests und unveränderte binäre Quellen gelten als aktuelle Dokumentation. Links, Bilder, Versionen und Begriffe werden automatisiert geprüft.",
        "module": "docs/requirements scripts/verify_architecture_docs.mjs",
        "tests": "npm run docs:verify und npm run requirements:verify",
    },
    {
        "id": "V1100-ROL-010",
        "section": "Rollenbezogene Einweisung",
        "requirement": "Für Kasse, Flight Line, Flight Director und FIDS existiert je ein einseitiges Rollenblatt, für Administration höchstens zwei Seiten. Markdown ist Quelle; PDF wird reproduzierbar erzeugt. Jedes Blatt enthält Einstieg, vier bis sechs Schritte, aktuellen Screenshot, Ablaufstreifen, Stopp/Hilfe und Rolleninvarianten.",
        "module": "docs/roles scripts/build_role_guides.py scripts/capture_role_guides.mjs",
        "tests": "npm run test:browser:roles und npm run docs:guides:check",
    },
    {
        "id": "V1100-CF-010",
        "section": "Cloudflare-Neuaufbau",
        "requirement": "Eine leere Cloudflare-Umgebung ist mit einem Zielnamen weitgehend automatisch und wiederaufnehmbar aufbaubar. Worker-, D1- und R2-Namen sind ableitbar oder überschreibbar; D1 und R2 verwenden EU-Jurisdiktion. Bestehende Ressourcen werden nie gelöscht oder geleert.",
        "module": "scripts/cloudflare_bootstrap.mjs scripts/cloudflare-target.mjs",
        "tests": "apps/worker/src/cloudflare-target-config.test.ts und Bootstrap-Dry-Run",
    },
    {
        "id": "V1100-CF-020",
        "section": "Cloudflare-Neuaufbau",
        "requirement": "Eine lokale, nicht versionierte Zielkonfiguration umfasst Static Assets, D1, R2, Durable Object, Rate Limits, Cron und Observability. Migrationen, Secrets, Build, Deployment und Smoke-Prüfung sind dokumentiert; Demo-Seeds bleiben ausgeschlossen.",
        "module": "scripts/cloudflare_verify.mjs docs/operations/cloudflare-neuaufbau.md .github/workflows/deploy-cloudflare.yml",
        "tests": "npm run cloudflare:verify und GitHub-Environment-Gate",
    },
    {
        "id": "V1100-SET-010",
        "section": "Werksreset und Ersteinrichtung",
        "requirement": "Ein authentifizierter Werksreset verlangt die aktuelle Konto-PIN und führt im selben Browser über eine 30 Minuten gültige, einmal verwendbare, gehashte und hostgebundene Fortsetzungsfreigabe ohne Konsolenarbeit zu /setup. Antwortverlust ist über denselben commandId idempotent wiederholbar.",
        "module": "apps/worker/src/reset-setup-grant.ts apps/web/src/setup-view.tsx",
        "tests": "npm run test:factory-reset und npm run test:first-run-setup",
    },
    {
        "id": "V1100-SEC-010",
        "section": "Installationssicherheit",
        "requirement": "Der Installations-Notfallcode besitzt mindestens 128 Bit Entropie, liegt ausschließlich als Worker-Secret und im Passwortsafe vor, funktioniert nur bei leerer Installation und wird rate-limitiert mit generischen Fehlern geprüft. PINs, Codes, Cookies und Secrets erscheinen nie in Logs, Backups, Screenshots oder Repository.",
        "module": "apps/worker/src/public-access.ts scripts/configure_cloudflare_setup.mjs",
        "tests": "Reset-/Setup-Integration und Secret-Scan",
    },
    {
        "id": "V1100-API-010",
        "section": "Interne API",
        "requirement": "Interne operative Clients verwenden ausschließlich /api/control/:eventId/.... JSON-Anfragen sind größenbegrenzt; fehlerhaftes JSON liefert 400, eine Überschreitung 413. Zugesicherte öffentliche Statusrouten bleiben kompatibel.",
        "module": "apps/worker/src/request-body-boundaries.ts apps/web/src/api.ts",
        "tests": "Worker-Runtime- und Routingtests",
    },
    {
        "id": "V1100-TYP-010",
        "section": "Generierte Worker-Typen",
        "requirement": "Worker-Bindings werden mit wrangler types erzeugt und bei jeder Typprüfung mit --check gegen wrangler.jsonc verifiziert.",
        "module": "apps/worker/src/worker-configuration.d.ts apps/worker/package.json",
        "tests": "npm run typecheck",
    },
    {
        "id": "V1100-MIG-010",
        "section": "Migrationen",
        "requirement": "SQL-Migrationen besitzen einen automatisch geprüften Registereintrag und eine Wiederherstellungsnotiz. Die historische Doppelnummer 0036 bleibt aus Gründen der angewandten D1-Historie unverändert und ist ausdrücklich registriert.",
        "module": "apps/worker/migrations scripts/verify_migrations.mjs",
        "tests": "npm run docs:migrations:check und Backup/Restore",
    },
    {
        "id": "V1100-DEP-010",
        "section": "Abhängigkeiten",
        "requirement": "Kompatible Patchstände werden kontrolliert aktualisiert; TypeScript bleibt in diesem Release auf 6.0.3. Dependabot schlägt wöchentlich gruppierte Patchupdates vor.",
        "module": "package-lock.json .github/dependabot.yml",
        "tests": "npm audit --omit=dev und npm run check",
    },
    {
        "id": "V1100-QA-010",
        "section": "Qualitätssicherung",
        "requirement": "Unit-, Worker-/D1-Integrations- und Browserprüfungen decken Reset/Setup, Bootstrap-Konfiguration, Rollenabläufe, responsive Darstellung, Dokumente und Backups ab. Der vollständige Abnahmelauf bleibt npm run check.",
        "module": "vitest.config.ts vitest.worker.config.ts scripts",
        "tests": "npm run check npm run test:worker-runtime npm run test:browser:roles",
    },
    {
        "id": "V1100-MOD-010",
        "section": "Modularisierung",
        "requirement": "Neue Setup-/Reset-, Request-Grenz- und Cloudflare-Ziellogik liegt in eigenständigen Modulen. Weitere Zerlegung der großen operativen Handler darf Atomarität, erwartete Version, Idempotenz, Audit, Outbox oder Veröffentlichung nach Persistenz nicht verändern.",
        "module": "apps/worker/src packages/contracts/src apps/web/src/features",
        "tests": "Typprüfung Unit-Tests Worker-Runtime und Browserabnahme",
    },
]

# Release-scoped clarifications leave the immutable V1.4 source files unchanged.
CURRENT_BASE_REQUIREMENT_OVERRIDES = {
    "F-RES-010": (
        "Jedes buchbare Produkt verwendet genau eine Ressourcengruppe. Die operative "
        "Produkt-Planzeit wird ausschließlich als Referenzzeit Offblock–Onblock am Produkt "
        "geführt; die davon getrennte kommunizierte Flugzeit ist reine Produktinformation und "
        "verändert keine operative Prognose. Die Ressourcengruppe besitzt keine eigene "
        "Plan-Umlaufzeit."
    ),
    "F-RES-060": (
        "Ein Produkt verwendet genau eine Ressourcengruppe. Flugzeugkompatibilität und "
        "Passagierkapazität werden aus den konkret aktiv zugeordneten Flugzeugen abgeleitet; "
        "Produktzeit und veranstaltungsweite Bodenzeiten bleiben getrennt. Es werden keine "
        "Freitext-Typenlisten, manuelle Gruppenkapazität oder eigene "
        "Ressourcengruppen-Umlaufzeit gepflegt."
    ),
    "F-BRD-100": (
        "Das System misst getrennt mindestens Boardingdauer, Offblock–Onblock-Zeit, Zeit von "
        "Onblock bis Abschluss und gesamte Umlaufzeit. Die Messpunkte werden aus den "
        "Primärereignissen abgeleitet."
    ),
    "F-PRG-030": (
        "Die Prognose berücksichtigt mindestens Referenzzeit Offblock–Onblock des Produkts, "
        "Flugzeugprofil, veranstaltungsweite Boarding-, Ausstiegs- und Pufferzeiten, aktuelle "
        "Flugzeugzustände, Pausen, Tanken, Unterbrechungen und Queue-Reihenfolge. Die "
        "Referenz-Umlaufzeit wird als Summe dieser vier Zeitanteile abgeleitet und nicht separat "
        "gespeichert."
    ),
    "D-015": (
        "Ressourcengruppe: Bezeichnung, Status, zugehörige Produkte, Gates, aktive "
        "Flugzeugzuordnungen und daraus abgeleitete Kapazitätsspanne; keine eigene "
        "Plan-Umlaufzeit."
    ),
    "D-020": (
        "Produkt: Bezeichnung, Kürzel, Preis, genau eine Ressourcengruppe, öffentliche "
        "Darstellung, Referenzzeit Offblock–Onblock, davon getrennte kommunizierte Flugzeit, "
        "Verkaufsregeln, Begleitpflicht und Sortierung; keine manuell gepflegte "
        "Referenzkapazität."
    ),
}


def yaml_scalar(value: object) -> str:
    return json.dumps(str(value), ensure_ascii=False)


def current_terms(value: object) -> str:
    text = str(value)
    replacements = [
        ("Flight Line Assist", "Flight Line"),
        ("Flight-Line-Supervisor-Ansicht", "Flight-Director-Ansicht"),
        ("Desktop-Supervisor-Ansicht", "Flight-Director-Ansicht"),
        ("Desktop-Supervisor", "Flight Director"),
        ("Assistenzansicht", "Flight-Line-Ansicht"),
        ("Flugleitung", "Flight Director"),
        ("Supervisor", "Flight Director"),
    ]
    for old, new in replacements:
        text = text.replace(old, new)
    text = re.sub(r"\bAssist\b", "Flight Line", text)
    return text


def current_requirements() -> list[dict[str, object]]:
    base = json.loads(BASE_YAML.read_text(encoding="utf-8"))
    with BASE_TRACE.open(newline="", encoding="utf-8-sig") as handle:
        base_trace_status = {row["ID"]: row["Status"] for row in csv.DictReader(handle)}
    normalized = [
        {
            "id": item["id"],
            "source": "1.4-konsolidiert",
            "section": item["section"],
            "requirement": CURRENT_BASE_REQUIREMENT_OVERRIDES.get(
                item["id"], current_terms(item["requirement"])
            ),
            "priority": item["priority"],
            "stage": item["stage"],
            "status": base_trace_status[item["id"]],
        }
        for item in base
    ]
    for path in DELTA_SOURCES:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if payload.get("version") != VERSION:
            raise ValueError(f"{path}: Zielversion muss {VERSION} sein")
        normalized.extend(
            {**item, "requirement": current_terms(item["requirement"])}
            for item in payload["requirements"]
        )
    normalized.extend(
        {
            "id": item["id"],
            "source": VERSION,
            "section": item["section"],
            "requirement": item["requirement"],
            "priority": "MUSS",
            "stage": "V1",
            "status": "implemented",
        }
        for item in RELEASE_REQUIREMENTS
    )
    return normalized


def render_yaml(requirements: list[dict[str, object]]) -> str:
    lines = [f"version: {VERSION}", "requirements:"]
    for item in requirements:
        lines.extend(
            [
                f"  - id: {item['id']}",
                f"    source: {yaml_scalar(item['source'])}",
                f"    section: {yaml_scalar(item['section'])}",
                f"    requirement: {yaml_scalar(item['requirement'])}",
                f"    priority: {item['priority']}",
                f"    stage: {item['stage']}",
                f"    status: {item['status']}",
            ]
        )
    return "\n".join(lines) + "\n"


def md_cell(value: object) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ")


def render_markdown(requirements: list[dict[str, object]]) -> str:
    release_ids = {item["id"] for item in RELEASE_REQUIREMENTS}
    release = [item for item in requirements if item["id"] in release_ids]
    historical_deltas = [
        item
        for item in requirements
        if item["id"] not in release_ids and item["source"] != "1.4-konsolidiert"
    ]
    base = [item for item in requirements if item["source"] == "1.4-konsolidiert"]
    lines = [
        "# Kumulativer Anforderungskatalog – Release 1.10.0",
        "",
        "Release `1.10.0` ist die einzige aktuelle Releasefassung. Dieser Katalog enthält den",
        "vollständigen 207er Basiskatalog, 99 fortgeltende und begrifflich aktualisierte Deltas",
        "aus 1.5 bis 1.9.1 sowie die 13 Anforderungen dieses Releases (insgesamt 319).",
        "Die binären V1.4-Quellen bleiben unveränderte Referenz; gültige ADRs konkretisieren den",
        "Katalog. Historische Releasekopien und Freigabeprotokolle sind keine Spezifikation.",
        "",
        "Die kanonischen Rollen- und Ansichtsbegriffe sind **Kasse**, **Flight Line**,",
        "**Flight Director**, **FIDS**, **Administration** und **öffentlicher Gruppenstatus**.",
        "",
        "## Anforderungen Release 1.10.0",
        "",
        "| ID | Abschnitt | Aktuelle Anforderung | Priorität | Status |",
        "| --- | --- | --- | --- | --- |",
    ]
    for item in release:
        lines.append(
            f"| {item['id']} | {md_cell(item['section'])} | {md_cell(item['requirement'])} | "
            f"{item['priority']} | {item['status']} |"
        )
    lines.extend(
        [
            "",
            "## Fortgeltende, in 1.10.0 konsolidierte Deltas",
            "",
            "Frühere reine Versionsanforderungen und durch 1.10.0 ersetzte UI-Konzeptbindungen sind",
            "nicht fortgeltend. Die folgenden fachlichen Aussagen bleiben verbindlich; alte Rollenbegriffe",
            "wurden auf Flight Line und Flight Director aktualisiert.",
            "",
            "| ID | Herkunft | Anforderung | Priorität | Status |",
            "| --- | --- | --- | --- | --- |",
        ]
    )
    for item in historical_deltas:
        lines.append(
            f"| {item['id']} | {item['source']} | {md_cell(item['requirement'])} | "
            f"{item['priority']} | {item['status']} |"
        )
    lines.extend(
        [
            "",
            "## Fortgeltender konsolidierter Basiskatalog",
            "",
            "| ID | Abschnitt | Anforderung | Priorität | Stufe | Status |",
            "| --- | --- | --- | --- | --- | --- |",
        ]
    )
    for item in base:
        lines.append(
            f"| {item['id']} | {md_cell(item['section'])} | {md_cell(item['requirement'])} | "
            f"{item['priority']} | {item['stage']} | {item['status']} |"
        )
    lines.extend(
        [
            "",
            "## Abgrenzung",
            "",
            "Backup-Import und Domain-Cutover sind getrennte Verfahren. Datenschutz-, Hardware-,",
            "Helfer- und Produktionsfreigaben bleiben manuelle Gates in `open-questions.md`.",
            "Passkeys, Cloudflare Access und Turnstile als zusätzliche Schicht sind nicht Bestandteil",
            "dieses Releases.",
            "",
        ]
    )
    return "\n".join(lines)


def render_traceability() -> str:
    with BASE_TRACE.open(newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle))
    for row in rows:
        for field in ("Kurzbeschreibung", "Modul", "Tests"):
            row[field] = current_terms(row[field])
    for path in DELTA_SOURCES:
        payload = json.loads(path.read_text(encoding="utf-8"))
        for item in payload["requirements"]:
            rows.append(
                {
                    "ID": item["id"],
                    "Stufe": item["stage"],
                    "Priorität": item["priority"],
                    "Abschnitt": item["section"],
                    "Kurzbeschreibung": item["requirement"],
                    "Issue": "",
                    "Modul": current_terms(item["module"]),
                    "Tests": current_terms(item["tests"]),
                    "Status": item["traceStatus"],
                }
            )
    for item in RELEASE_REQUIREMENTS:
        rows.append(
            {
                "ID": item["id"],
                "Stufe": "V1",
                "Priorität": "MUSS",
                "Abschnitt": item["section"],
                "Kurzbeschreibung": item["requirement"],
                "Issue": "",
                "Modul": item["module"],
                "Tests": item["tests"],
                "Status": "umgesetzt",
            }
        )
    output = io.StringIO(newline="")
    writer = csv.DictWriter(
        output,
        fieldnames=[
            "ID",
            "Stufe",
            "Priorität",
            "Abschnitt",
            "Kurzbeschreibung",
            "Issue",
            "Modul",
            "Tests",
            "Status",
        ],
        lineterminator="\n",
    )
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue()


def outputs() -> dict[Path, str]:
    requirements = current_requirements()
    return {
        CURRENT_YAML: render_yaml(requirements),
        CURRENT_MD: render_markdown(requirements),
        CURRENT_TRACE: render_traceability(),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    mismatches: list[Path] = []
    for path, expected in outputs().items():
        if args.write:
            path.write_text(expected, encoding="utf-8", newline="\n")
        elif not path.exists() or path.read_text(encoding="utf-8-sig") != expected:
            mismatches.append(path)
    if mismatches:
        names = ", ".join(str(path.relative_to(ROOT)) for path in mismatches)
        raise SystemExit(f"Aktuelle Requirements sind nicht generiert: {names}")
    print("OK: 319 aktuelle Anforderungen und Traceability-Einträge für Release 1.10.0")


if __name__ == "__main__":
    main()
