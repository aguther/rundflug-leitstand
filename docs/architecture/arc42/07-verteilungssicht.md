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
        CRON["Cron Trigger<br/>0 * * * * und 15 2 * * *"]
        WF["Cloudflare Workflow<br/>PlanningHistoryCompactionWorkflow"]
    end

    GH["GitHub Actions<br/>Branch-/PR-CI und einziges automatisches Deployment"]
    PUSH["Push-Dienste der Browserhersteller"]

    TAB & DESK & MON & GAST --> NET --> EDGE --> WK
    WK --> DOI --> D1
    WK --> D1
    WK --> R2
    WK --> RL
    CRON --> WK
    WK --> WF --> D1
    WF --> R2
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
| Workflow | Cloudflare Workflows, Bindung `PLANNING_HISTORY_COMPACTION` | eine langlebige, wiederaufnehmbare Kompaktion je Planungshistoriensegment |

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
| Variable | `PLANNING_DETAIL_RETENTION_HOURS` (24) | heißes Detailfenster; zulässig 24 bis 168 Stunden, in Produktion explizit |
| Variable | `PLANNING_HISTORY_RETENTION_YEARS` (5) | kalte Planungshistorie; zulässig fünf bis zehn Kalenderjahre, in Produktion explizit |
| Variable | `SOURCE_REVISION` | im Deployment gesetzter Commit; Grundlage für Replay-Vergleiche |
| Secret | `ADMIN_PIN_HASH` | langsamer, gesalzener Hash der Administrator-PIN |
| Secret | `BOOTSTRAP_TOKEN` | einmalige Ersteinrichtung; niemals in Rollenunterlagen oder Logs |
| Secret | `DEPLOYMENT_BACKUP_TOKEN_HASH` | ausschließlich SHA-256-Hash des GitHub-Environment-Tokens für den internen Pre-Deployment-Backup-Endpunkt |
| Secret | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web-Push-Authentifizierung; der private Schlüssel verlässt Cloudflare Secrets nicht |

Secrets werden ausschließlich über Cloudflare Secrets beziehungsweise `.dev.vars` gesetzt.
`scripts/check_no_secrets.sh` und die Definition of Done verhindern, dass Geheimnisse in Diffs, Logs
oder Testfixtures auftauchen.

## 7.4 Bereitstellung

```mermaid
flowchart TB
    PUSH["Push auf jeden Branch"] --> CI["parallele Gates:<br/>Coverage, Runtime, Shards,<br/>Restore, Doku, Mutation"]
    CI --> SONAR["SonarQube Branch Quality Gate"]
    PR["Pull Request"] --> PRSONAR["zusätzliche SonarQube-PR-Analyse"]
    SONAR --> MAIN{"Commit auf main?"}
    MAIN -->|"nein"| DONE["Prüfergebnis für Arbeitsbranch"]
    MAIN -->|"ja"| BUILD["commitgebundener Build"]
    BUILD --> PREFLIGHT["Preflight: vorhandener Worker,<br/>D1-ID, EU-R2, Bindings, Secrets;<br/>Auto-Create aus"]
    PREFLIGHT --> MIG{"online-sichere Migrationen offen?"}
    MIG -->|"nein"| DEP["wrangler deploy --strict"]
    MIG -->|"ja"| BACKUP["D1-Time-Travel-Bookmark<br/>+ portables PRE_DEPLOY-Backup"]
    BACKUP --> APPLY["freigegebene Migrationen anwenden"]
    APPLY --> DEP
    DEP --> VERIFY["Health, Migrationen, Secrets<br/>und exakte SOURCE_REVISION prüfen"]
    MON["monatlich: Cloudflare-Maintenance"]
    MON --> RUNTIME["Compatibility-Date, Toolchain,<br/>Bindings, Runtime, Logs, Health/Meta"]
```

GitHub Actions ist die einzige automatische Deployment-Autorität. Jeder Branch wird unabhängig von
einem Pull Request geprüft. `main` wird erst nach allen Gates automatisch ausgerollt; der manuelle
Workflow bleibt als Wiederanlauf mit Bestätigung `DEPLOY` verfügbar. Native automatische
Cloudflare-Git-Builds sind nach erfolgreicher Inbetriebnahme dieses Pfads deaktiviert.

Der Preflight legt niemals Ressourcen an. Er verlangt den vorhandenen Worker, die exakte D1-ID und
den vorhandenen EU-R2-Bucket. Nur unveränderte, per SHA-256 geprüfte und ausdrücklich online-sichere
Folgemigrationen werden nach D1-Bookmark und portablem Backup automatisch angewendet. Der einmalige
inkompatible Neustart auf `0001_v1_12_baseline.sql` bleibt ausschließlich dem vollständigen Neuaufbau
aus ADR-0045 vorbehalten. Details: ADR-0057 und `docs/operations/ci-cd-stabilitaet.md`.
