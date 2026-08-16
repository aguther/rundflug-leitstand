# 7. Verteilungssicht

## 7.1 Infrastruktur der Abnahmeumgebung

```mermaid
flowchart TB
    subgraph Gelaende["Flugplatzgelände"]
        TAB["Tablets: Kasse, Flight Line,<br/>Flight Director (installierte PWA)"]
        DESK["Desktop: Administration,<br/>Flight Director"]
        MON["Monitore: FIDS-Browser<br/>mit DISPLAY-Konto"]
        GAST["Gastgeräte: Ticket-/Gruppenstatus,<br/>optional installierte PWA für Push"]
    end

    NET["Internet über Mobilfunk/WLAN<br/>(Dual-SIM als Rückfall)"]

    subgraph CF["Cloudflare-Konto des Vereins – EU-Jurisdiktion"]
        EDGE["Cloudflare-Edge<br/>HTTPS/TLS, Assets-Auslieferung"]
        WK["Worker rundflug-leitstand<br/>APP_ENV=acceptance"]
        DOI["Durable Object EventCoordinator<br/>eine Instanz je Veranstaltung, SQLite"]
        D1[("D1 rundflug-leitstand<br/>V1.12-Baseline + Migrationen")]
        R2[("R2 rundflug-leitstand<br/>jurisdiction eu")]
        RL["Rate-Limiting-Bindings<br/>30/60 s öffentlich, 5/60 s Adminwiederherstellung"]
        CRON["Cron Trigger 15 2 * * *"]
    end

    GH["GitHub Actions<br/>CI und manuelles Deployment"]
    PUSH["Push-Dienste der Browserhersteller"]

    TAB & DESK & MON & GAST --> NET --> EDGE --> WK
    WK --> DOI --> D1
    WK --> D1
    WK --> R2
    WK --> RL
    CRON --> WK
    WK --> PUSH
    GH -->|"wrangler deploy"| WK
    GH -->|"d1 migrations apply"| D1
```

| Knoten | Ausführungsumgebung | Bemerkung |
| --- | --- | --- |
| Endgeräte | moderne Browser, installierbare PWA je Rolle (eigene Web-App-Manifeste und Icons) | Offline-Snapshot in IndexedDB; iOS-Web-Push erfordert die installierte PWA |
| Worker | V8-Isolate am Cloudflare-Edge, `compatibility_date` 2026-08-15, `nodejs_compat` | liefert zusätzlich die statischen Assets aus; `/api/*` und Rollenpfade laufen zuerst durch den Worker; persistierte Logs und niedrig gesampelte Traces sind aktiviert |
| Durable Object | SQLite-basiert, außerhalb der Entwicklung mit `jurisdiction("eu")` angefordert | genau eine aktive Instanz je Veranstaltung; hibernierende WebSockets |
| D1 | Cloudflare-verwaltetes SQLite, Bindung `DB` | Source of Truth; Time Travel als kurzfristiger Wiederherstellungspfad |
| R2 | Bucket mit `jurisdiction: eu`, Bindung `BACKUPS` | portable ZIP-/NDJSON-Sicherungen als Multipart-Archiv plus SHA-256-Sidecar, Veranstaltungslogos und Analysepakete; keine öffentlichen Bucket-URLs |
| Cron | Cloudflare Cron Trigger | täglicher Wartungslauf, siehe Kapitel 6.6 |

## 7.2 Umgebungen

| Umgebung | Zweck | Besonderheiten |
| --- | --- | --- |
| Lokale Entwicklung | `npm run dev` | Vite auf `http://localhost:5173`, Wrangler/Miniflare auf `http://localhost:8787`; Vite leitet `/api` und WebSockets weiter; lokale D1 mit synthetischen Seed-Daten; `APP_ENV=development` verzichtet auf die EU-Jurisdiktionsanforderung, weil workerd sie lokal nicht abbildet |
| Prognosesimulator | `npm run simulator` | reine Browserausführung unter `/simulation` und eigenständiges FIDS unter `/simulation/fids`, ohne Worker, D1 oder Anmeldung; beide Tabs synchronisieren flüchtigen Zustand über einen gleichursprünglichen `BroadcastChannel`; im Cloudflare-Build zusätzlich lazy hinter Anmeldung und Rolle `ADMIN` |
| Abnahme (aktuell) | Cloudflare, `APP_ENV=acceptance` | einzige betriebene Cloudflare-Umgebung; `/api/meta` meldet `productionReady: false` |
| Produktion (Gate) | erst nach vollständiger V1-Abnahme | verbindlich getrennte D1-Datenbank, separater EU-R2-Bucket und getrennte Secret-Sätze (ADR-0007) |

## 7.3 Konfiguration und Geheimnisse

| Art | Schlüssel | Wirkung |
| --- | --- | --- |
| Variable | `APP_ENV` | `development`, `acceptance` oder Produktionswert; steuert HTTPS-Erzwingung und Jurisdiktionsanforderung |
| Variable | `DATA_JURISDICTION` | dokumentiert und meldet die EU-Verarbeitung über `/api/meta` |
| Variable | `PUSH_RETENTION_DAYS` (7) | Löschfrist für Push-Abonnements nach Veranstaltungsende |
| Variable | `ANALYSIS_RETENTION_DAYS` (30) | Ablauf der Tagesanalysepakete in R2 |
| Variable | `SOURCE_REVISION` | im Deployment gesetzter Commit; Grundlage für Replay-Vergleiche |
| Secret | `ADMIN_PIN_HASH` | langsamer, gesalzener Hash der Administrator-PIN |
| Secret | `BOOTSTRAP_TOKEN` | einmalige Ersteinrichtung; niemals in Rollenunterlagen oder Logs |
| Secret | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web-Push-Authentifizierung; der private Schlüssel verlässt Cloudflare Secrets nicht |

Secrets werden ausschließlich über Cloudflare Secrets beziehungsweise `.dev.vars` gesetzt.
`scripts/check_no_secrets.sh` und die Definition of Done verhindern, dass Geheimnisse in Diffs, Logs
oder Testfixtures auftauchen.

## 7.4 Bereitstellung

```mermaid
flowchart TB
    PR["Pull Request"] --> CI["CI: npm ci, test:coverage,<br/>check:ci, SonarQube"]
    CI --> MAIN["Fast-forward nach main"]
    MAIN --> WD["workflow_dispatch:<br/>target, apply_migrations, Bestätigung DEPLOY"]
    WD --> FULL["npm run check (vollständig)"]
    FULL --> MIG{"offene D1-Migrationen?"}
    MIG -->|"apply_migrations = true"| APPLY["wrangler d1 migrations apply --remote"]
    MIG -->|"false und offene Migrationen"| STOP["Abbruch mit Hinweis"]
    APPLY --> BUILD["npm run build:web"]
    MIG -->|"keine offenen"| BUILD
    BUILD --> DEP["wrangler deploy"]
    MAIN --> MON["monatlich: Cloudflare-Maintenance"]
    MON --> RUNTIME["Compatibility-Date, Toolchain,<br/>Bindings, Runtime, Logs, Health/Meta"]
```

Das Deployment ist bewusst manuell auszulösen und verlangt die exakte Eingabe `DEPLOY` sowie eine
Zielumgebung. Der einmalige inkompatible Neustart auf `0001_v1_12_baseline.sql` erfolgt ausschließlich
über den in ADR-0045 beschriebenen vollständigen Neuaufbau. Danach sind Migrationen vorwärtsgerichtet
und besitzen jeweils eine Wiederherstellungs- oder Forward-Repair-Notiz; ein manueller Spaltenabbau in
der laufenden Datenbank ist nicht vorgesehen.

Der monatliche Workflow läuft gegen das geschützte Ziel `rundflug-leitstand`. Nur dort gilt das
45-Tage-Ratchet für die Compatibility-Date; normale PR- und Build-Läufe bleiben zeitstabil. Der
einmalige Baseline-Neuaufbau verwendet das read-only startende CLI aus ADR-0049. Deployment und
Remote-Seeds sind ausdrücklich kein Bestandteil dieses Löschkommandos.
