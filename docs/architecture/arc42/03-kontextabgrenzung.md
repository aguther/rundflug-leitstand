# 3. Kontextabgrenzung

## 3.1 Fachlicher Kontext

```mermaid
flowchart TB
    PAPIER["Papierprozess<br/>und Nacherfassung"]
    KAS["Kasse<br/>CASHIER"]
    FLN["Flight Line<br/>FLIGHT_LINE"]
    FLD["Flight Director<br/>FLIGHT_DIRECTOR"]
    ADM["Administration<br/>ADMIN"]

    SYS(["Rundflug-Leitstand"])

    DSP["FIDS-Monitor<br/>DISPLAY"]
    GAST["Gast mit Ticket-QR"]
    GRP["Gruppenkontakt<br/>mit Gruppencode"]
    BESU["Besucher am Monitor"]
    PUSH["Push-Dienste<br/>der Browser"]
    PRINT["POS-58-Bondrucker"]

    PAPIER -.->|"Nacherfassung nach Ausfall"| FLN
    KAS -->|"Verkauf, Storno, Korrektur"| SYS
    FLN -->|"bestätigte Ist-Ereignisse"| SYS
    FLD <-->|"Disposition, Queue, Prognose"| SYS
    ADM -->|"Stammdaten und Parameter"| SYS
    KAS -.->|"window.print()"| PRINT

    SYS -->|"Board-Projektion"| DSP
    SYS <-->|"anonymer Ticketstatus"| GAST
    SYS <-->|"Gruppenstatus"| GRP
    SYS -->|"Fluggruppen und Gates"| BESU
    SYS -->|"eingewilligte Meldung"| PUSH
    PUSH -.->|"Zustellung an installierte PWA"| GAST

    classDef operativ fill:#e8eefc,stroke:#3d5a99
    classDef oeffentlich fill:#eefaf0,stroke:#2f7d4f
    classDef umsystem fill:#fdf3e3,stroke:#a5762f
    class KAS,FLN,FLD,ADM,DSP operativ
    class GAST,GRP,BESU oeffentlich
    class PUSH,PRINT,PAPIER umsystem
```

Blau: angemeldete operative Rollen. Grün: öffentliche Nutzung ohne Anmeldung. Orange: Umsysteme und
Rückfallebene. Gestrichelte Kanten laufen außerhalb der Anwendung.

| Nachbar | Fachliche Ein-/Ausgabe |
| --- | --- |
| Kasse | Verkauf ganzer Buchungsgruppen, Storno, Korrektur, Zurückstellung, Klärungsfälle, Ticketdruck mit QR-Code |
| Flight Line | bestätigte Ist-Ereignisse eines Umlaufs, Anwesenheit, Gruppennachruf, No-Show |
| Flight Director | Dispatch-Empfehlungen und -Bestätigungen, Flotten- und Pilotenzustände, weicher Betriebsplan, Unterbrechung und Notfallmodus |
| Administration | Veranstaltungen, Produkte, Ressourcengruppen, Gates, Flugzeuge, Piloten, Parameter, Konten, Vorlagen, Berichte, Werksreset |
| FIDS-Monitor | gebundene Board-Projektion je Veranstaltung und Seite, keine Schreibfunktion |
| Gast | anonymer Ticket-/Gruppenstatus, optionale Push-Einwilligung, keine Anmeldung und keine Namensangabe |
| Push-Dienste | verschlüsselte Zustellung an einen browserseitig erzeugten Endpunkt; keine Rückmeldung fachlicher Daten |
| Bondrucker | lokaler Ausdruck über den Standard-Druckdialog des Browsers; keine Treiberintegration im System |
| Papierprozess | dokumentierter Ausfallbetrieb mit anschließender geprüfter Nacherfassung |

## 3.2 Technischer Kontext

```mermaid
flowchart LR
    subgraph Client["Endgeräte"]
        PWA["React-PWA<br/>Service Worker, IndexedDB"]
        MON["Monitor-Browser"]
        MOB["Gast-Browser / installierte PWA"]
    end

    subgraph CF["Cloudflare (EU-Jurisdiktion)"]
        W["Worker<br/>API + statische Assets"]
        DO["Durable Object<br/>EventCoordinator je Veranstaltung"]
        D1[("D1<br/>relationale Source of Truth")]
        R2[("R2<br/>Sicherungen, Logos, Analysepakete")]
        RL["Rate-Limiting-Bindings"]
        CRON["Cron Trigger 02:15 UTC"]
    end

    GH["GitHub Actions<br/>CI und Wrangler-Deployment"]
    WP["Push-Dienste der Browser"]

    PWA -->|"HTTPS + WSS<br/>/api/control/*"| W
    MON -->|"HTTPS<br/>/fids, /api/public/*"| W
    MOB -->|"HTTPS<br/>/ticket, /gruppe"| W
    W --> DO
    W --> D1
    DO --> D1
    W --> R2
    W --> RL
    CRON --> W
    W -->|"aes128gcm + VAPID"| WP
    GH -->|"Deployment"| W
```

| Schnittstelle | Protokoll / Technik | Zweck |
| --- | --- | --- |
| `/api/control/:eventId/commands` | HTTPS POST, typisierte Kommando-Umschläge | einziger Schreibpfad für operative Änderungen |
| `/api/control/:eventId/operations`, `/snapshot` | HTTPS GET | bestätigter materialisierter Zustand für angemeldete operative Clients |
| `/api/control/:eventId/live` | WebSocket (Hibernation) | Signal „neue bestätigte Veranstaltungsversion“ ohne Nutzdaten |
| `/api/public/tickets/:ticketCode`, `/api/public/groups/:groupCode` | HTTPS GET, Hash-Lookup, Rate Limit 30/60 s | anonymer Gast- und Gruppenstatus |
| `/api/public/events/:eventId/board`, `/live`, `/logo` | HTTPS GET, WebSocket | öffentliche Monitorprojektion und Veranstaltungslogo |
| `/api/auth/*`, `/api/setup*`, `/api/admin/*` | HTTPS, Secure-/HttpOnly-Sitzungscookies | Anmeldung, Ersteinrichtung, Konten- und Sicherheitsverwaltung |
| `/api/.../reports/daily.csv`, `daily.pdf`, `exports/*` | HTTPS GET | Tagesberichte, CSV-/JSON-Exporte, Simulationsgrundlage |
| Statische Assets | Cloudflare Assets-Binding, SPA-Fallback | Auslieferung der PWA; `/api/*` und Rollenpfade laufen zuerst durch den Worker |
| Web Push | HTTPS an den browserseitigen Endpunkt, `aes128gcm`, VAPID (RFC 8188/8291/8292) | eingewilligte Statusmeldungen; Löschung nach `PUSH_RETENTION_DAYS` |
| D1-Bindung `DB` | Cloudflare-Bindung, SQL-Batches | Zustand, Ereignisprotokoll, Idempotenzbelege, Outbox |
| Durable-Object-Bindung `EVENT_COORDINATOR` | Cloudflare-Bindung, SQLite-DO | Serialisierung der Kommandos, Realtime-Verteilung, Prognosetakt |
| R2-Bindung `BACKUPS` (EU) | Cloudflare-Bindung | portable Sicherungen, Veranstaltungslogos und Analysearchive |
| Cron `15 2 * * *` | Cloudflare Cron Trigger | Sicherung, Push-Löschfrist, Analysearchive |
| Deployment | GitHub Actions + Wrangler; automatisch nach grünem `main`, manuell wiederanlaufbar | commitgebundener Preflight, Backup, freigegebene Migrationen und Revisionsprüfung ohne Ressourcenanlage |
