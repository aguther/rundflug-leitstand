#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import io
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = "1.12.0"
BASE_YAML = ROOT / "docs/requirements/requirements-v1.4.yaml"
BASE_TRACE = ROOT / "docs/requirements/traceability.csv"
CURRENT_RELEASE_SOURCE = ROOT / "scripts/data" / f"requirements-delta-{VERSION}.json"
LEGACY_DELTA_SOURCES = sorted(
    path
    for path in (ROOT / "scripts/data").glob("requirements-delta-*.json")
    if path != CURRENT_RELEASE_SOURCE
)
CURRENT_YAML = ROOT / f"docs/requirements/requirements-v{VERSION}.yaml"
CURRENT_MD = ROOT / f"docs/requirements/requirements-v{VERSION}.md"
CURRENT_TRACE = ROOT / f"docs/requirements/traceability-v{VERSION}.csv"

RELEASE_1_10_REQUIREMENTS = [
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
    "F-PRG-020": (
        "Nach jedem relevanten Ereignis und während des aktiven Betriebs zusätzlich mindestens "
        "alle 30 Sekunden werden erwartetes Boarding, Start, Landung, Abschluss, verbleibende "
        "Wartezeit und alle abhängigen Folgeflüge automatisch neu berechnet. Ein reiner "
        "deterministischer und begrenzter Dispatch-Plan plant dabei mehrere Bahnen und nahe "
        "Batches gemeinsam; Produktion und Simulator verwenden dieselbe Domainlogik."
    ),
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
        "Flugzeugzustände, Pausen, Tanken, Unterbrechungen, vollständige Gruppen, Sitzkapazität, "
        "Produktfairness, Wartealter, begrenzte Überholungen und Planstabilität. Pro "
        "produktreinem Batch wird genau eine Bahn reserviert; alle Mitglieder erhalten dasselbe "
        "Boardingfenster. Die Referenz-Umlaufzeit wird als Summe der vier Zeitanteile abgeleitet "
        "und nicht separat gespeichert."
    ),
    "F-BEN-030": (
        "Das System prüft während des aktiven Betriebs regelmäßig und nach relevanten Ereignissen "
        "den frischen Dispatch-Plan, reale Flugzeugverfügbarkeit und Anwesenheitslage und löst für "
        "nahe Batches automatisch Bereithalten oder Bitte zum Gate aus. Ein Gate-Wegvorlauf von "
        "0 bis 30 Minuten wird zum adaptiven Basisvorlauf addiert, verändert aber nicht das "
        "Boardingfenster und wird für das Lernen aus der Beobachtung herausgerechnet. Nicht "
        "passende Vordergruppen oder unabhängige Ressourcengruppen am selben Gate blockieren den "
        "Aufruf nicht. Die konkrete Flugzeugbelegung und der Boardingstart bleiben getrennt und "
        "werden erst menschlich bestätigt."
    ),
    "F-BEN-090": (
        "Öffentliche Statusbezeichnungen sind auf wenige handlungsorientierte Zustände zu "
        "reduzieren: Warten, Bereithalten, Bitte zum Gate, Boarding, Abgeflogen beziehungsweise "
        "Flug läuft, Verzögert, Gelandet und Abgeschlossen. Das Terminalprofil bildet diese auf "
        "WAITING, PREPARE, GO TO GATE, BOARDING, DEPARTED und DELAYED ab. FIDS priorisiert "
        "Boarding, Bitte zum Gate, Bereithalten und Warten; innerhalb eines Zustands gelten "
        "Dispatch-Plan, Prognose, Queue und stabile ID."
    ),
    "Q-ZUV-020": (
        "Verbindungsaussetzer und vorübergehende Server- oder D1-Fehler werden ohne Leeren der "
        "Oberfläche überbrückt. Der letzte bestätigte Stand bleibt mit Alter und "
        "Verbindungsstatus sichtbar; unbestätigte Schreibaktionen bleiben gesperrt und werden "
        "nicht als operative Änderungen gezählt. Dispatch-Bestätigungen übermitteln "
        "Planrevision und Batch-ID; veraltete Empfehlungen und stale writes werden abgewiesen "
        "und niemals still überschrieben."
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

CURRENT_DELTA_REQUIREMENT_OVERRIDES = {
    "V18-GRP-010": {
        "requirement": (
            "Eine Buchungsgruppe besitzt genau einen öffentlichen Gruppen-QR-Code und einen "
            "aggregierten Status für alle Teilflüge. Öffentlicher Gruppenstatus, "
            "Legacy-Ticketstatus und konkrete umlaufbezogene Push-Nachrichten verwenden dieselbe "
            "aktuelle Teilflugprojektion; Teilflugnummer und -anzahl werden gruppenweise "
            "deterministisch aus nicht freigegebenen Ticketzuordnungen zu nicht stornierten "
            "Umläufen abgeleitet."
        ),
        "module": (
            "packages/domain/src/public-status.ts "
            "apps/worker/src/booking-group-part-projection.ts "
            "apps/worker/src/index.ts apps/worker/src/web-push.ts "
            "apps/web/src/features/public-status/PublicStatusContent.tsx"
        ),
        "tests": (
            "Domain- und Contract-Tests, Worker-D1-Projektion, Push-Tests, "
            "Public-Monitors-Integration und Browserabnahme"
        ),
    },
    "V18-API-010": {
        "requirement": (
            "Verträge liefern ISO-Zeitfenster und Zeitzone; PublicTicketStatus enthält additiv "
            "den fachlich vorhandenen Teilflugkontext, und Gruppenroute sowie "
            "Legacy-Ticketroute bleiben ohne interne Umlauf- oder Fluggruppenkennungen parallel "
            "verfügbar."
        ),
        "module": (
            "packages/contracts/src/index.ts apps/worker/src/index.ts "
            "apps/web/src/ticket-status-view.tsx apps/web/src/group-status-view.tsx"
        ),
        "tests": (
            "Contract-Tests, Worker-D1-Projektion, Public-Monitors-Integration und UI-DOM-Test"
        ),
    },
    "V18-QA-010": {
        "requirement": (
            "Automatisierte und visuelle Abnahme deckt Busy, Zeitfenster, Tabellen, "
            "Gruppendruck, kanonischen Splitstatus, teilflugbezogenen Umlauf-Push, Legacy, "
            "Hell-/Dunkelmodus, mobile Viewports und Geheimhaltung ab."
        ),
        "module": "Workspace-Prüfskripte und docs/ui/v1.11.0-release-concept.md",
        "tests": (
            "Vollständiger Check, Worker-Runtime-, Public-Monitors- und Browserabnahme"
        ),
    },
}

CURRENT_BASE_STATUS_OVERRIDES = {
    "F-PRG-020": "umgesetzt",
    "F-BEN-030": "umgesetzt",
}

CURRENT_BASE_TRACE_OVERRIDES = {
    "F-PRG-020": {
        "Kurzbeschreibung": "Ereignisbasierte Neuberechnung mit gemeinsamem deterministischem Dispatch-Plan für Produktion und Simulator.",
        "Modul": "BP-06",
        "Tests": "ADR-0032 + packages/domain/src/dispatch-plan.ts + packages/domain/src/forecast.ts + apps/worker/src/event-coordinator.ts + Simulator",
        "Status": "umgesetzt",
    },
    "F-PRG-030": {
        "Kurzbeschreibung": "Produktreine kapazitätskonforme Batches reservieren je eine Bahn und projizieren für alle Mitglieder dasselbe Boardingfenster.",
        "Modul": "BP-06",
        "Tests": "ADR-0032 + Dispatch-/Forecast-Domaintests A bis K + Worker- und Simulatorregression",
    },
    "F-BEN-030": {
        "Kurzbeschreibung": "Dispatch-basierter Vorabruf mit sitzbezogenen nahen Batches und zusätzlichem Gate-Wegvorlauf ohne Verschiebung des Boardingfensters.",
        "Modul": "BP-07",
        "Tests": "ADR-0032 + packages/domain/src/precall.ts + Migration 0060 + Gate-Import/Export/Backup + Simulator- und Browsertests",
        "Status": "umgesetzt",
    },
    "F-BEN-090": {
        "Kurzbeschreibung": "Handlungsorientierte öffentliche Zustände mit stabiler FIDS-Priorität nach Dispatch-Plan und Prognose.",
        "Modul": "BP-07",
        "Tests": "ADR-0029/0032 + PREPARE/BEREITHALTEN + Worker-FIDS-Prioritätstest + Simulation-FIDS + Browser Hell/Dunkel",
    },
    "Q-ZUV-020": {
        "Kurzbeschreibung": "Verbindungs-, Server- und D1-Fehler leeren die Oberfläche nicht; Dispatch-Bestätigungen mit veralteter Revision oder Batch-ID werden abgewiesen.",
        "Modul": "BP-09",
        "Tests": "Integration D1-Fehler/Offline-Replay/Konflikte + DISPATCH_PLAN_STALE + E2E Ausfall/Wiederverbindung",
    },
}

RELEASE_1_11_REQUIREMENTS = [
    {
        "id": "V1110-REL-010",
        "section": "Release und Versionierung",
        "requirement": "Anwendung, Workspace-Pakete, /api/meta, Healthcheck, Backups, Requirements und Traceability melden konsistent 1.11.0.",
        "module": "package.json packages/config apps/worker/src/index.ts apps/worker/src/backup.ts",
        "tests": "scripts/verify_requirements.py und npm run check",
    },
    {
        "id": "V1110-REC-010",
        "section": "Aktiver Gruppennachruf",
        "requirement": "Ein Nachruf ist ein eigenständig persistierter temporärer Vorgang mit eindeutiger ID, gruppenbezogener Sequenz, Start- und Ablaufzeit sowie optionalem Ende. Pro Buchungsgruppe ist höchstens ein Nachruf aktiv.",
        "module": "packages/domain/src/ticket-group-recall.ts apps/worker/migrations/0055_ticket_group_recalls.sql",
        "tests": "packages/domain/src/ticket-group-recall.test.ts und apps/worker/src/ticket-group-recall.test.ts",
    },
    {
        "id": "V1110-REC-020",
        "section": "Aktiver Gruppennachruf",
        "requirement": "Der Nachruf verändert weder Queueposition noch Belegung oder Anwesenheit. Er endet manuell, nach bestätigter Anwesenheit, Boardingbeginn, Zurückstellung, No-Show, Storno oder spätestens nach fünf Minuten automatisch.",
        "module": "apps/worker/src/event-coordinator.ts",
        "tests": "npm run test:ticket-group-recall",
    },
    {
        "id": "V1110-CMD-010",
        "section": "Kommandos und Konsistenz",
        "requirement": "START_TICKET_GROUP_RECALL und CLEAR_TICKET_GROUP_RECALL verwenden Event-Coordinator, erwartete Version und Idempotenz. Parallele stale writes werden abgewiesen; RESTORE_TICKET_GROUP_TO_QUEUE benennt die bisherige Queueaktion fachlich eindeutig und RECALL_TICKET_GROUP bleibt kontrollierter Kompatibilitätsalias.",
        "module": "packages/contracts/src/index.ts packages/domain/src/index.ts apps/worker/src/event-coordinator.ts",
        "tests": "packages/contracts/src/index.test.ts und npm run test:ticket-group-recall",
    },
    {
        "id": "V1110-AUD-010",
        "section": "Audit und Outbox",
        "requirement": "Start und jedes manuelle oder automatische Ende erzeugen append-only Audit-Ereignisse mit Nachruf-ID, Gruppenzuordnung, Sequenz und Endgrund sowie einen konsistenten Outbox-Eintrag.",
        "module": "apps/worker/src/event-coordinator.ts",
        "tests": "apps/worker/src/ticket-group-recall.test.ts und npm run test:ticket-group-recall",
    },
    {
        "id": "V1110-PSH-010",
        "section": "Gruppenspezifischer Web-Push",
        "requirement": "Jeder neu gestartete Nachruf erzeugt Web-Push ausschließlich für aktive Ticket- und Gruppenstatus-Abonnements derselben Buchungsgruppe. Die Deduplizierung berücksichtigt die Nachruf-ID, sodass ein späterer Nachruf erneut zugestellt wird.",
        "module": "apps/worker/src/web-push.ts apps/worker/migrations/0055_ticket_group_recalls.sql",
        "tests": "apps/worker/src/web-push.test.ts und npm run test:ticket-group-recall",
    },
    {
        "id": "V1110-PUB-010",
        "section": "Öffentliche Projektionen",
        "requirement": "Ticketstatus, Gruppenstatus und FIDS projizieren denselben aktiven Nachruf mit festen, gruppen- und gatebezogenen Textvorlagen. Der Vorgang enthält keine Namen, Telefonnummern oder frei formulierten öffentlichen Texte.",
        "module": "apps/worker/src/index.ts apps/web/src/features/public-status/PublicStatusContent.tsx",
        "tests": "apps/worker/src/ticket-group-recall.test.ts und npm run test:ticket-group-recall",
    },
    {
        "id": "V1110-FID-010",
        "section": "FIDS",
        "requirement": "Das FIDS zeigt den Nachruf direkt in der betroffenen Gruppenzeile als priorisierten Status Nachruf aktiv mit Glocke und bewegungsreduzierbarer Pulsanimation. Der normale Umlaufstatus bleibt zusätzlich sichtbar und unverändert.",
        "module": "apps/web/src/fids-display.tsx apps/web/src/features/fids/fids-v12.css",
        "tests": "Browser-Abnahme FIDS Light und Dark",
    },
    {
        "id": "V1110-UI-010",
        "section": "Flight Line und Flight Director",
        "requirement": "Geeignete offene Gruppen werden ohne Bestätigungsdialog direkt über einen Glocken-Button nachgerufen. Derselbe Button bleibt an fester Position als klar erkennbarer aktiver Umschalter sichtbar; Startzeit und bisherige Anzahl sind im zugänglichen Tooltip enthalten, und erneutes Betätigen beendet den Nachruf.",
        "module": "apps/web/src/flight-line-view.tsx apps/web/src/flight-line-shared.tsx",
        "tests": "apps/web/src/flight-line-recall.dom.test.tsx und Browser-Abnahme Flight Line und Flight Director",
    },
    {
        "id": "V1110-MIG-010",
        "section": "Migration und Wiederherstellung",
        "requirement": "Die D1-Migration für Nachrufe und Push-Deduplizierung besitzt eine Wiederherstellungsnotiz; Nachrufdaten sind in Backup, Ereignislöschung und Werksreset vollständig berücksichtigt.",
        "module": "apps/worker/migrations/0055_ticket_group_recalls.sql apps/worker/src/backup.ts",
        "tests": "npm run docs:migrations:check und npm run backup:restore:test",
    },
    {
        "id": "V1110-QA-010",
        "section": "Qualitätssicherung",
        "requirement": "Automatisierte Tests prüfen Start, manuelles und automatisches Ende, Idempotenz, Parallelkonflikt, Ablaufzeit, erneuten Push, gruppenspezifische Zustellung, Projektionen, Rollen, Audit und Outbox. Flight Line, Flight Director, FIDS und mobile öffentliche Ansicht werden visuell abgenommen.",
        "module": "scripts/verify_ticket_group_recall.mjs apps/worker/src/ticket-group-recall.test.ts",
        "tests": "npm run test:ticket-group-recall npm run test und npm run check",
    },
]

CURRENT_RELEASE_PAYLOAD = json.loads(CURRENT_RELEASE_SOURCE.read_text(encoding="utf-8"))
if CURRENT_RELEASE_PAYLOAD.get("version") != VERSION:
    raise ValueError(f"{CURRENT_RELEASE_SOURCE}: Zielversion muss {VERSION} sein")
CURRENT_RELEASE_REQUIREMENTS = CURRENT_RELEASE_PAYLOAD["requirements"]
PRIOR_RELEASE_REQUIREMENTS = [
    *({**item, "source": "1.10.0"} for item in RELEASE_1_10_REQUIREMENTS),
    *({**item, "source": "1.11.0"} for item in RELEASE_1_11_REQUIREMENTS),
]


def yaml_scalar(value: object) -> str:
    return json.dumps(str(value), ensure_ascii=False)


def current_terms(value: object) -> str:
    text = str(value)
    replacements = [
        ("docs/ui/v1.10.0-release-concept.md", f"docs/ui/v{VERSION}-release-concept.md"),
        ("docs/ui/v1.11.0-release-concept.md", f"docs/ui/v{VERSION}-release-concept.md"),
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
            "status": CURRENT_BASE_STATUS_OVERRIDES.get(item["id"], base_trace_status[item["id"]]),
        }
        for item in base
    ]
    for path in LEGACY_DELTA_SOURCES:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if payload.get("version") != "1.10.0":
            raise ValueError(f"{path}: historische Zielversion muss 1.10.0 sein")
        normalized.extend(
            {
                **item,
                **CURRENT_DELTA_REQUIREMENT_OVERRIDES.get(item["id"], {}),
                "requirement": current_terms(
                    CURRENT_DELTA_REQUIREMENT_OVERRIDES.get(item["id"], {}).get(
                        "requirement", item["requirement"]
                    )
                ),
            }
            for item in payload["requirements"]
        )
    normalized.extend(
        {
            "id": item["id"],
            "source": item["source"],
            "section": item["section"],
            "requirement": item["requirement"],
            "priority": "MUSS",
            "stage": "V1",
            "status": "implemented",
        }
        for item in PRIOR_RELEASE_REQUIREMENTS
    )
    normalized.extend(
        {
            "id": item["id"],
            "source": item["source"],
            "section": item["section"],
            "requirement": current_terms(item["requirement"]),
            "priority": item["priority"],
            "stage": item["stage"],
            "status": item["status"],
        }
        for item in CURRENT_RELEASE_REQUIREMENTS
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
    release_ids = {item["id"] for item in CURRENT_RELEASE_REQUIREMENTS}
    release = [item for item in requirements if item["id"] in release_ids]
    historical_deltas = [
        item
        for item in requirements
        if item["id"] not in release_ids and item["source"] != "1.4-konsolidiert"
    ]
    base = [item for item in requirements if item["source"] == "1.4-konsolidiert"]
    lines = [
        f"# Kumulativer Anforderungskatalog – Release {VERSION}",
        "",
        f"Release `{VERSION}` ist die einzige aktuelle Releasefassung. Dieser Katalog enthält den",
        "vollständigen 207er Basiskatalog, 123 fortgeltende und begrifflich aktualisierte Deltas",
        "aus 1.5 bis 1.11.0 sowie die 10 Anforderungen dieses Releases (insgesamt 340).",
        "Die binären V1.4-Quellen bleiben unveränderte Referenz; gültige ADRs konkretisieren den",
        "Katalog. Historische Releasekopien und Freigabeprotokolle sind keine Spezifikation.",
        "",
        "Die kanonischen Rollen- und Ansichtsbegriffe sind **Kasse**, **Flight Line**,",
        "**Flight Director**, **FIDS**, **Administration** und **öffentlicher Gruppenstatus**.",
        "",
        f"## Anforderungen Release {VERSION}",
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
            f"## Fortgeltende, in {VERSION} konsolidierte Deltas",
            "",
            f"Frühere reine Versionsanforderungen und durch {VERSION} ersetzte UI-Konzeptbindungen sind",
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
            "Nicht Bestandteil sind Kamera- oder QR-Scan, eine eigenständige Ansicht Gruppen am Gate,",
            "eine harte Boarding-Sperre, SMS, Messenger und frei formulierte Nachruftexte.",
            "Für Analyseexporte sind ein unbereinigtes Vollprofil, eine Restore-/Produktionsimportfunktion",
            "und Änderungen am Dispatch-, Forecast- oder Voraufrufalgorithmus ausdrücklich ausgeschlossen.",
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
        row.update(CURRENT_BASE_TRACE_OVERRIDES.get(row["ID"], {}))
    for path in LEGACY_DELTA_SOURCES:
        payload = json.loads(path.read_text(encoding="utf-8"))
        for item in payload["requirements"]:
            current_item = {
                **item,
                **CURRENT_DELTA_REQUIREMENT_OVERRIDES.get(item["id"], {}),
            }
            rows.append(
                {
                    "ID": current_item["id"],
                    "Stufe": current_item["stage"],
                    "Priorität": current_item["priority"],
                    "Abschnitt": current_item["section"],
                    "Kurzbeschreibung": current_item["requirement"],
                    "Issue": "",
                    "Modul": current_terms(current_item["module"]),
                    "Tests": current_terms(current_item["tests"]),
                    "Status": current_item["traceStatus"],
                }
            )
    for item in PRIOR_RELEASE_REQUIREMENTS:
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
    for item in CURRENT_RELEASE_REQUIREMENTS:
        rows.append(
            {
                "ID": item["id"],
                "Stufe": item["stage"],
                "Priorität": item["priority"],
                "Abschnitt": item["section"],
                "Kurzbeschreibung": item["requirement"],
                "Issue": "",
                "Modul": item["module"],
                "Tests": item["tests"],
                "Status": item["traceStatus"],
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
    print(f"OK: 340 aktuelle Anforderungen und Traceability-Einträge für Release {VERSION}")


if __name__ == "__main__":
    main()
