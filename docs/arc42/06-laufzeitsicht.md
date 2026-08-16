# 6. Laufzeitsicht

## 6.1 Schreibkommando: Verkauf an der Kasse

```mermaid
sequenceDiagram
    autonumber
    participant K as Kasse (PWA)
    participant W as Worker (Routen)
    participant DO as EventCoordinator
    participant D as D1
    participant C as weitere Clients

    K->>W: POST /api/control/:eventId/commands<br/>SELL_TICKET_GROUP, ticketCount, commandId, expectedVersion
    W->>W: Body-Grenze, JSON, Sitzungscookie, Vertrag (Zod)
    W->>DO: weiterleiten an DO-Instanz der Veranstaltung
    DO->>DO: Kommandos seriell einreihen (commandTail)
    DO->>D: vorhandenen Idempotenzbeleg lesen
    alt Beleg vorhanden
        D-->>DO: gespeicherter Beleg einschließlich Codes
        DO-->>K: 200, identischer Beleg, duplicate: true
    else neues Kommando
        DO->>DO: Gerät, Rolle, Version, Kapazität, Gruppenschutz
        alt Version veraltet
            DO-->>K: 409 STALE_VERSION (keine Änderung)
        else zulässig
            DO->>DO: Gruppen- und Ticketcodes mit Worker-WebCrypto erzeugen
            DO->>D: Codehashes kollisionsfrei gegen Gruppen und Tickets prüfen
            DO->>D: ein Batch: tickets/ticket_groups/flight_groups<br/>+ operational_events + idempotency_receipts + outbox
            D-->>DO: Commit bestätigt
            DO-->>K: 200, neue Veranstaltungsversion, bestätigter Beleg mit Codes
            DO-->>C: Versionssignal über /live
            C->>W: GET /api/control/:eventId/operations
            DO->>DO: asynchroner Prognoselauf
        end
    end
```

Wesentlich: Die Antwort an die Kasse erfolgt erst nach dem Commit. Erst danach erfahren andere
Geräte, dass eine neue Version existiert, und laden ihre jeweils berechtigte Sicht. Der Ticketdruck
verwendet die bereits bestätigte Antwort. Die PWA wählt keine öffentlichen Codes; eine Wiederholung
derselben `commandId` liest den zuerst gespeicherten Beleg, bevor neue Codes erzeugt würden.

## 6.2 Umlauf an der Flight Line

```mermaid
stateDiagram-v2
    [*] --> DRAFT: Fluggruppe geplant
    DRAFT --> CALLED: CALL_NEXT<br/>Flugzeug + Pilot gebunden, Flugzeug BOARDING
    CALLED --> DRAFT: REVOKE_CALL<br/>Bindung aufgehoben, auditiert
    CALLED --> IN_FLIGHT: MARK_IN_FLIGHT (Offblock)
    IN_FLIGHT --> LANDED: MARK_LANDED (Onblock)
    LANDED --> COMPLETED: MARK_COMPLETED<br/>erst jetzt Flugzeug AVAILABLE
    COMPLETED --> [*]
    note right of LANDED
        GELANDET ist ausdrücklich nicht VERFÜGBAR.
        Ab IN_FLIGHT sind Besetzung, Anwesenheit
        und Queue-Korrekturen gesperrt.
    end note
```

Der automatische Voraufruf (`AUTOMATIC_PRECALL`, öffentlich „Bitte zum Gate“) läuft vor `CALL_NEXT`
und bindet weder Flugzeug noch Pilotencode; er ist bis zur bewussten Bestätigung reversibel.

## 6.3 Prognoselauf nach einem bestätigten Ereignis

```mermaid
sequenceDiagram
    autonumber
    participant DO as EventCoordinator
    participant F as forecast-timeline-service + packages/domain
    participant D as D1
    participant P as Web Push
    participant C as verbundene Clients

    DO->>F: Neuberechnung nach erfolgreicher Fachtransaktion
    F->>D: offene Umläufe, Ist-Zeiten, bis zu 12 Vergleichsumläufe,<br/>Pausen, weiche Pläne, wiederkehrende Regeln
    F->>F: aktive Timelines und Verfügbarkeitsbahnen berechnen
    opt aktive Completion-Projektion hat sich geändert
        F->>F: Dispatch mit denselben Eingaben und demselben Zeitpunkt<br/>einmal konsistent nachberechnen
    end
    F->>F: Dispatch-Fenster, Gewichtung,<br/>Ausreißerfilter, Qualitätsstufe
    F->>D: Prognosefelder aktualisieren + unveränderlichen Snapshot je Umlauf anhängen
    F->>F: Voraufrufbedingungen prüfen
    opt Voraufruf ausgelöst
        F->>D: AUTOMATIC_PRECALL mit Audit und Outbox
        F->>P: eingewilligte Benachrichtigung einreihen
    end
    F-->>DO: Ergebnis
    DO-->>C: forecast-updated
    Note over F,DO: Scheitert der Lauf, bleibt der bestätigte<br/>operative Zustand gültig (FORECAST_RECALCULATION_FAILED).<br/>Der nächste Zustandswechsel startet einen neuen Lauf.
```

Der Prognoselauf verändert keine bestätigten Ist-Ereignisse. Zusätzlich taktet der
Durable-Object-Alarm die Neuberechnung alle 30 Sekunden und beendet fällige Gruppennachrufe über
dieselbe serielle Kommandogrenze.

Die einmalige interne Nachberechnung verhindert, dass ein durch Debouncing zusammengefasster
Commandlauf einen Dispatch-Vorschlag noch aus den zuvor gespeicherten Completion-Zeiten aktiver
Flugzeuge oder Piloten ableitet. Beide Rechenschritte verwenden denselben geladenen Zustand und
denselben Berechnungszeitpunkt; nur der konvergierte Endstand wird persistiert, als Analysepaket
erfasst und veröffentlicht.

## 6.4 Verbindungsverlust und Wiederaufnahme

```mermaid
sequenceDiagram
    autonumber
    participant C as Operativer Client
    participant IDB as IndexedDB
    participant W as Worker
    participant DO as EventCoordinator

    C->>W: WSS /api/control/:eventId/live
    W->>DO: Hibernation-WebSocket registrieren
    Note over C: Verbindung bricht ab
    C->>C: letzten bestätigten Snapshot anzeigen,<br/>Alter und Störungsstatus kennzeichnen
    C->>C: operative Schreibaktionen sperren
    C->>IDB: lokal reversible Kassenentwürfe (max. 50 Revisionen)
    loop 1 s bis 15 s Backoff
        C->>W: erneuter Verbindungsversuch (authentifiziert)
    end
    C->>W: GET /api/control/:eventId/snapshot (vollständig)
    W-->>C: bestätigter Zustand mit aktueller Version
    C->>C: Schreibaktionen freigeben, Entwürfe bewusst gegen die aktuelle Version bestätigen
    Note over C,W: Parallel bleibt ein berechtigter Statusabruf alle 15 s als Fallback aktiv.<br/>Verspätete Antworten mit älterer Version ersetzen keinen neueren Stand.
```

Operativ wirksame Kommandos werden offline nicht angenommen (OQ-01): Verkauf, Storno, Neuverkauf nach
Korrektur, Boardingstart, `IM FLUG`, `GELANDET`, `ABGESCHLOSSEN`, Not-Halt und Stammdatenänderungen
benötigen eine Serverbestätigung und werden bei fehlender Verbindung sichtbar gesperrt.

## 6.5 Öffentlicher Ticketstatus

```mermaid
sequenceDiagram
    autonumber
    participant G as Gast-Browser
    participant W as Worker
    participant RL as Rate-Limiting-Binding
    participant D as D1

    G->>W: GET /api/public/tickets/:ticketCode
    W->>W: SHA-256 des Codes bilden
    W->>D: Suche ausschließlich über den Hash
    alt Ticket bekannt
        D-->>W: minimaler öffentlicher DTO
        W-->>G: Zeitfenster oder Warteposition, Handlungshinweis
    else unbekannt oder syntaktisch ungültig
        W->>RL: Fehlversuch zählen (Hash der Akteursadresse, flüchtig)
        alt Limit 30 je 60 s überschritten
            RL-->>W: abgewiesen
            W-->>G: 429 mit Retry-After
        else innerhalb des Limits
            W-->>G: 404 mit neutraler Antwort
        end
    end
```

Erfolgreiche Abrufe verbrauchen das Fehlversuchslimit nicht. Weder Adresse noch Hash werden in D1, im
Auditprotokoll oder in Anwendungslogs gespeichert.

## 6.6 Nächtlicher Wartungslauf (Cron `15 2 * * *`)

```mermaid
sequenceDiagram
    autonumber
    participant CR as Cloudflare Cron
    participant W as Worker scheduled()
    participant D as D1
    participant R as R2 (EU)

    CR->>W: geplanter Aufruf
    W->>D: abgelaufene Push-Abonnements löschen (PUSH_RETENTION_DAYS, Standard 7)
    W->>D: abgelaufene Analysearchive markieren (ANALYSIS_RETENTION_DAYS, Standard 30)
    W->>R: ausstehende Tagesanalysepakete erzeugen
    W->>D: Betriebstage von morgen prüfen
    alt Veranstaltung in Vorbereitung oder aktiv
        W->>R: portable Sicherung mit Grund PRE_EVENT
    else kein Betriebstag
        W->>R: portable Sicherung mit Grund DAILY
    end
    W->>W: strukturierte Logzeile mit Schlüssel und Prüfsumme (ohne Tokens)
```

## 6.7 Ausfall und Papier-Nacherfassung

Bei einem Totalausfall der Verbindung arbeitet die Veranstaltung nach der dokumentierten
Papier-Rückfallebene weiter. Nach dem Wiederanlauf wird ein Nacherfassungsbatch angelegt und
durchläuft `STAGED`/`CONFLICTED` → `APPROVED` (Vier-Augen-Prinzip) → `APPLIED`. Simulation und
Anwendung prüfen erneut die Veranstaltungsversion; doppelte Belegfolgen, doppelte Ticketcodes,
zukünftige Zeitpunkte, fehlende Referenzen und ungültige Umlaufübergänge blockieren den gesamten
Batch, statt Teilzustände zu erzeugen.

## 6.8 Lesen und Projizieren des Operations-Boards

```mermaid
sequenceDiagram
    autonumber
    participant C as Operativer Client
    participant W as Worker (Operations-Route)
    participant D as D1

    C->>W: GET /api/control/:eventId/operations
    W->>D: ein D1-Batch mit 14 vorbereiteten Leseabfragen
    D-->>W: positionsgleiche Read-Model-Ergebnisse
    opt optionale Kompatibilitätstabelle vorhanden
        W->>D: Flight-Line-Assist-Claims lesen
        D-->>W: Assist-Claims
    end
    W->>W: Produkte, Umläufe, Ressourcen, Pläne und Regeln einmalig indexieren
    W->>W: DTOs ohne wiederholte lineare Gesamtsuchen projizieren
    W-->>C: vollständige berechtigte Boardprojektion
```

Der Normalpfad benötigt für die 14 unabhängigen Kernabfragen genau einen D1-Roundtrip. Die optionale
Assist-Claims-Abfrage bleibt bis zum Ende ihres Kompatibilitätsfensters getrennt. Fehlt in einem
älteren Schema `gates.display_filter_json`, wird der vollständige Read-Batch einmal mit der
kompatiblen Leerprojektion wiederholt; andere Fehler werden nicht verschluckt. Die Projektion baut
vor der DTO-Erzeugung Lookup- und Gruppierungsindizes auf und verändert weder Fachregeln noch den
bestätigten D1-Zustand.

## 6.9 Vollständiger Werksreset

```mermaid
sequenceDiagram
    autonumber
    participant A as Administration
    participant W as Worker
    participant DO as EventCoordinatoren
    participant D as D1
    participant R as R2 (EU)

    A->>W: Werksreset mit Sitzung, Gerät, aktueller PIN und commandId
    W->>R: optionale portable Wiederherstellungssicherung
    W->>DO: Alarm, Storage und Live-Verbindungen je Veranstaltung leeren
    loop begrenzte Löschphasen, Planläufe in abhängigkeitssicheren Chunks
        W->>D: begrenzte Löschtransaktion mit aufgeschobenen Fremdschlüsseln
    end
    W->>D: finale Transaktion: Identität und Wurzeln löschen, Reset-Beleg schreiben
    opt alle R2-Inhalte löschen
        W->>R: Bucket seitenweise leeren
    end
    W-->>A: Setup-Fortsetzungsgrant und Reset-Beleg
```

Eine fehlgeschlagene Bulk-Phase kann bereits geleerte Nutzdatentabellen hinterlassen, löscht aber
noch nicht den Administratorzugang. Der zulässige Forward-Repair ist die Wiederholung des
Werksresets; die finale Transaktion erzeugt den idempotenten Beleg erst nach vollständigem
D1-Abschluss. ADR-0050 begründet diese Abweichung von einem einzigen, bei großen Historien nicht
ausführbaren D1-Batch.
