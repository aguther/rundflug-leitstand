# Betriebskonzept für Diagnose- und Tagesanalysepakete

Status: WP1 bis WP4 umgesetzt; Produktionsaktivierung bleibt vom vollständigen Abnahmelauf abhängig

Architektur: ADR-0034

UI: `docs/ui/analysis-export-concept.md`

Requirements: V1120-DIA-010 bis V1120-QA-010

## Zweck und Abgrenzung

Analysepakete unterstützen die technische Rekonstruktion von Forecast-, Dispatch-, Voraufruf-,
Persistenz- und UI-Abweichungen. Sie sind keine regulären Tagesberichte, keine portable Sicherung
und keine flugbetriebliche oder sicherheitsrelevante Freigabe.

Das System bietet nach Freigabe zwei getrennte Arbeitsmittel:

| Stufe | Zeitpunkt | Format | Zweck |
| --- | --- | --- | --- |
| Diagnose-Momentaufnahme | während Vorbereitung, Betrieb oder Nachlauf | einzelne JSON-Datei | aktueller konsistenter Board-, Planungs- und optionaler UI-Zustand |
| Tagesanalysepaket | ausschließlich `CLOSED` oder `ARCHIVED` | serverseitiges ZIP in R2 | vollständige sichere Tagesanalyse und Offline-Replay |

Beide Formate verwenden ausschließlich das Datenschutzprofil `SUPPORT_SAFE`. Ein Restore oder
Import in eine produktive Datenbank ist ausdrücklich ausgeschlossen.

## Rollen

- `ADMIN`: Momentaufnahme, Archivliste, Erstellung/Retry, Download und Löschung.
- `FLIGHT_DIRECTOR`: Momentaufnahme in der Flight-Director-Oberfläche.
- `CASHIER`, `FLIGHT_LINE`, `DISPLAY` und öffentliche Benutzer: kein Zugriff.
- `SYSTEM`: automatische Archivanlage nach erfolgreichem Schließen sowie Wartungs- und
  Ablaufverarbeitung.

Jede Serverroute prüft die Rolle erneut. Die Sichtbarkeit einer UI-Aktion ersetzt keine
Berechtigungsprüfung.

## Diagnose-Momentaufnahme

### Standardablauf

1. Benutzer aktualisiert den sichtbaren Veranstaltungsstand.
2. **Aktuelle Momentaufnahme exportieren** wird ausgelöst.
3. Der Browser übermittelt die sichtbare Veranstaltungsversion als Erwartungswert.
4. Der Worker lädt Board, passenden jüngsten Planungslauf und dessen Forecast-Snapshots.
5. Die Veranstaltungsversion wird vor und nach dem Lesen geprüft; bei Änderung wird höchstens
   zweimal neu gelesen und danach kontrolliert abgebrochen.
6. Der Browser validiert das Server-JSON, ergänzt den flüchtigen Allowlist-Clientkontext und
   validiert das Gesamtobjekt erneut.
7. Die lokale Datei wird als
   `rundflug-analyse-momentaufnahme-<event-date>-<local-time>.json` gespeichert.

Die Datei darf nur über einen vom Verantwortlichen freigegebenen Supportkanal weitergegeben
werden. Trotz Bereinigung enthält sie interne IDs, Betriebszeiten, Queue-Beziehungen,
Flugzeugkennzeichen und pseudonyme operative Pilotencodes.

### Konflikte und Fehler

| Code | Bedeutung | Bedienhandlung |
| --- | --- | --- |
| `ANALYSIS_SNAPSHOT_STALE_VERSION` | sichtbare Erwartungsversion ist veraltet | Ansicht aktualisieren, erneut exportieren |
| `ANALYSIS_SNAPSHOT_NOT_READY` | passender erfolgreicher Planungslauf fehlt noch | kurze Zeit warten, erneut laden |
| `ANALYSIS_SNAPSHOT_CHANGED` | Veranstaltung änderte sich während des Lesens | aktualisieren, erneut exportieren |
| `ANALYSIS_SNAPSHOT_DATA_INCOMPLETE` | Lauf, Payload oder Forecast-Snapshot ist unvollständig | nicht weitergeben; technischen Fehlercode melden |

Es gibt keinen Fallback auf einen älteren Planungslauf und keinen Export eines gemischten Stands.

## Hybride Planungsläufe

Jeder Forecast-Lauf speichert eine kompakte Lineage. Unveränderte Timer-Ticks verwenden denselben
Kontext; fachliche Ereignisse, diagnostisch relevante Ergebniswechsel, manuelle Diagnose und der
spätestens nach fünf Minuten fällige Vollanker erzeugen einen neuen Anker. Zwischen zwei Ankern
liegen höchstens zehn Referenzläufe.

Kanonische Eingangsdaten werden in wiederverwendbare Chunks mit höchstens 50 Einträgen zerlegt. Ein
Kontextmanifest referenziert die Chunks, statt den vollständigen 300-Umlauf-Zustand zu duplizieren.
`calculation_now` steht ausschließlich am Lauf. Dispatch- und Voraufrufergebnisse werden nur bei
Änderung oder Anker vollständig gespeichert; Forecast-Snapshot-Zeilen bleiben im bestehenden
30-Sekunden-Takt erhalten und referenzieren denselben Lauf.

Chunks, Kontexte und erfolgreiche Laufzeilen sind append-only. Sie werden nicht als operative
Ereignisse gezählt und lösen selbst keine Realtime-Nachricht aus. Ein erfolgreicher Lauf existiert
nur zusammen mit vollständig persistierten Rotation-Projektionen und Snapshots.

## Tagesanalysepaket

### Automatische und manuelle Erzeugung

Beim erfolgreichen Übergang nach `CLOSED` wird genau ein Archivjob für die bestätigte
Veranstaltungsversion angelegt. Der Schließbefehl wartet nicht auf R2. Ein nachlaufender Builder
übernimmt den Job konditional und erstellt das Archiv. Dieselbe Logik wird für eine manuelle
Admin-Anforderung verwendet.

Eine erneute Anforderung derselben Kombination aus Veranstaltung, Quellversion, Formatversion und
Datenschutzprofil liefert den vorhandenen logischen Archivdatensatz. `request_id` und
`request_hash` sichern die Kommandoidempotenz; ein abweichender Hash derselben Request-ID wird als
Konflikt abgewiesen.

### Zustände

```text
PENDING -> BUILDING -> READY
                   -> FAILED -> PENDING -> BUILDING
READY -> EXPIRED
READY -> DELETED
```

`READY` wird erst nach vollständigem R2-Multipart-Abschluss und gespeicherter Objektmetadatenreferenz
gesetzt. Ein fehlgeschlagener oder abgebrochener Upload wird niemals als downloadbar gemeldet. Ein
`BUILDING`-Claim ohne Fortschritt wird nach 15 Minuten automatisch mit dem festen Fehlercode
`ARCHIVE_BUILD_TIMEOUT` nach `FAILED` überführt und kann anschließend kontrolliert erneut gestartet
werden.

### R2-Ablage

Die vorhandene private EU-R2-Bindung wird verwendet:

```text
analysis/<event-id>/<event-date>/<archive-id>.zip
```

R2 besitzt keine öffentliche Analyse-Domain. Downloads laufen ausschließlich über die
authentifizierte Workerroute. Custom Metadata enthält nur Format, Formatversion, Anwendungs-,
Requirements- und Quellrevision, Event-ID/-Version, Datenschutzprofil und Erstellzeit. Keine
Konto-, Geräte-, Token-, Push-, Freitext- oder Netzwerkdaten werden als R2-Metadaten abgelegt.

### Paketstruktur

```text
manifest.json
README.md
snapshot/event.json
planning/runs.ndjson
planning/contexts.ndjson
planning/chunks.ndjson
history/forecast-snapshots.ndjson
history/operational-events.ndjson
history/analysis-archive-events.ndjson
state/*.ndjson
reports/queue.csv
reports/forecast-windows.csv
reports/resource-timeline.csv
```

Jede Datei besitzt eine definierte Projektion. `state/*.ndjson` ist kein Tabellendump.
`operational-events.ndjson` verwendet eine Allowlist je Ereignistyp; unbekannte Payloads werden
vollständig redigiert.

## Datenschutzprofil `SUPPORT_SAFE`

### Zulässig, soweit erforderlich

- technische interne Event-, Ressourcen-, Gruppen-, Ticket-, Fluggruppen- und Umlauf-IDs,
- Kommunikationsnummern und Queue-Reihenfolge,
- Produkt-/Ressourcengruppenbeziehungen,
- operative Zeitstempel und Forecast-Fenster,
- Dispatch-Revisionen, Batches, Lanes, feste technische Grundcodes und Überholungswerte,
- Flugzeugkennzeichen und pseudonyme Pilotencodes,
- aggregierte Zähl-, Größen-, Auslastungs- und Dauerwerte.

### Verboten

- öffentliche Ticket- oder Gruppencodes und deren Hashes,
- Sitzungs-, Geräte-, Setup- oder Push-Credentials,
- Administrator-PINs oder Credential-Hashes,
- Konto-IDs und Login-Codes,
- Push-Endpunkte und Browser-Schlüssel,
- Einzelgewichte und nicht erforderliche Zahlungsfelder,
- freie Notizen, Gründe und rohe Ereignis-Payloads,
- vollständige User Agents, IPs und Infrastrukturmetadaten.

Secret- und Datenschutz-Canaries werden automatisiert in alle gefährdeten Felder geschrieben und
müssen in JSON, ZIP, R2-Metadaten, Dateinamen und Fehlerlogs vollständig fehlen.

## Aufbewahrung

Neue Konfiguration:

```text
ANALYSIS_RETENTION_DAYS=30
```

Regeln:

- gültiger Bereich `14..365`,
- Entwicklung und Abnahme zunächst 30 Tage,
- Produktion nur mit ausdrücklich freigegebenem Wert aus OQ-18,
- keine Ableitung aus der Backup-Frist,
- `expires_at` wird beim Archivauftrag festgeschrieben.

Der tägliche Wartungslauf verarbeitet abgelaufene Archive paginiert und sequenziell:

1. abgelaufene `READY`-Datensätze auswählen,
2. R2-Objekt löschen,
3. Status `EXPIRED` speichern,
4. `ARCHIVE_EXPIRED` append-only ergänzen.

Eine optionale R2-Lifecycle-Regel darf nur als länger laufendes Sicherheitsnetz dienen. Die
Anwendungslogik bleibt führend, weil sie D1-Status und Analysezugriffsprotokoll konsistent halten
muss.

## Download und Löschung

Ein Download:

1. prüft `ADMIN` und den Eventbezug,
2. verlangt Status `READY`,
3. schreibt `ARCHIVE_DOWNLOADED` ohne operative Event-Version,
4. liest den privaten R2-Key,
5. streamt den Body direkt mit `no-store` und Attachment-Dateiname.

Manuelle Löschung ist idempotent. R2 wird gelöscht, D1 wechselt auf `DELETED` und
`ARCHIVE_DELETED` wird ergänzt. Archivmetadaten und Zugriffsprotokoll bleiben zur
Nachvollziehbarkeit erhalten.

Bei Veranstaltungslöschung werden die eventbezogenen D1-Zeilen in der geschützten Reset-Grenze
gelöscht und alle Objekte unter `analysis/<event-id>/` anschließend paginiert entfernt. Bis zum
erfolgreichen R2-Abschluss bleibt ein wiederholbarer Cleanup-Beleg bestehen. Der Werksreset umfasst
Analyseobjekte und neue Tabellen. Diese Vorgänge bleiben destruktiv und folgen den bereits
dokumentierten Bestätigungs- und Wiederherstellungsregeln.

## Portable Backups

Folgende D1-Tabellen werden nach ihrer Einführung in das portable Backupregister aufgenommen:

```text
planning_chunks
planning_contexts
planning_runs
analysis_archives
analysis_archive_events
```

Die R2-ZIP-Dateien selbst werden nicht in das portable JSON-Backup eingebettet. Nach einem Restore
in eine isolierte D1-Instanz müssen Archivmetadaten, R2-Objektverfügbarkeit und Status ausdrücklich
abgeglichen werden. Ein fehlendes R2-Objekt darf nicht als gültiges `READY` behandelt werden.

## Source-Revision

`SOURCE_REVISION` enthält die Git-Commit-ID des Builds. Lokal ist `local` oder `unknown` zulässig.
CI und Produktion setzen einen konkreten Wert. `/api/meta`, Planungsläufe, Momentaufnahme und
Tagesmanifest geben ihn aus. Er enthält weder Build-Secret noch CI-Token.

## Offline-Replay

Aufruf:

```bash
npm run analysis:replay -- ./rundflug-analyse-....json
npm run analysis:replay -- ./rundflug-tagesanalyse-....zip --all
```

Standardworkflow für historische Pakete:

```bash
git checkout <manifest.sourceRevision>
npm ci
npm run analysis:replay -- <package>
```

Das Werkzeug prüft zuerst Contract, Pflichtdateien, Referenzen und Payload-Hashes. Danach führt es
Dispatch, Forecast und Voraufruf mit dem exportierten `calculation_now` erneut aus. Bei einer
Abweichung werden Lauf-ID, Zeitpunkt, Auslöser, Event-Version, erster JSON-Pfad, Erwartungs- und
Istwert ausgegeben.

`--allow-version-mismatch` erlaubt eine diagnostische Berechnung auf anderem Quellstand, markiert
das Ergebnis aber ausdrücklich als versionsabweichend. Das Werkzeug schreibt niemals in D1, R2
oder eine Produktionsumgebung.

## Nachgewiesenes Maximalszenario

`npm run test:analysis-scale` bildet 1.440 Läufe mit 300 Umläufen, Ankern im
Fünf-Minuten-Abstand, die vollständige Snapshot-Laufreferenz und alle relevanten SQLite-Indizes ab.
Der lokale Abnahmelauf vom 2. August 2026 ergab 45,21 MB zusätzlichen D1-Platz, 1,561 ms
Capture-p95 und 7,92 Prozent zusätzliche CPU im Vergleich zum projizierten Forecastpfad. Die
Messwerte sind ein reproduzierbarer lokaler Guardrail; die Produktionsaktivierung verlangt
zusätzlich den Cloudflare-Messlauf im Zielkonto.

## Supportübergabe

Vor einer Weitergabe:

1. richtigen Veranstaltungstag und Zeitpunkt bestätigen,
2. sichtbares Profil `Support-sicher` prüfen,
3. Dateiname, Größe, Manifestversion und `sourceRevision` dokumentieren,
4. Datei ausschließlich über den freigegebenen Supportkanal übertragen,
5. Empfänger und Zweck außerhalb des Pakets dokumentieren,
6. lokale Kopie nach Abschluss entsprechend der Betreiberregel löschen.

Der Support darf nicht um ein unbereinigtes Paket, Rohdatenbankdump, Sitzungscookie oder
Browserprofil bitten. Zusätzliche Daten benötigen eine neue dokumentierte Freigabe.

## Monitoring und Betriebsnachweis

Zu messen und ohne interne IDs oder Secrets strukturiert zu protokollieren:

- Zahl und Dauer erfolgreicher/fehlgeschlagener Planungscaptures nach Capture-Modus,
- Kontext- und Chunk-Wiederverwendung sowie tatsächlicher D1-Zuwachs einschließlich Indizes,
- zusätzliche CPU im p95 und relativ zum Forecast-Lauf,
- Snapshot-Größe und Erzeugungszeit,
- Archivlaufzeit, R2-Größe und Anzahl Einträge,
- D1-Seitenzahl, maximale Puffergröße und Multipart-Teile,
- Retry-, Abbruch-, Ablauf- und Löschresultate.

Logs verwenden feste technische Codes und aggregierte Messwerte. R2-Key, interne Event-ID,
Archiv-ID, Konto, Ticket- oder Gruppenbezug werden nicht ungeprüft in zentrale Logs geschrieben.

## Störungen

- `FAILED`: sicheren Fehlercode prüfen, Ursache beheben, denselben Job erneut starten.
- R2-Ausfall: Archiv bleibt `FAILED` oder `BUILDING` mit ausgelaufenem Claim; niemals manuell auf
  `READY` setzen.
- D1-/R2-Divergenz: Download sperren, Integritätsvorfall dokumentieren und gegen Backup/R2-Head
  prüfen.
- beschädigtes Paket: nicht importieren; Replay-Integritätsbericht und Quellrevision sichern.
- Verdacht auf Datenexposition: Weitergabe stoppen, Paket isolieren, Datenschutz-/Sicherheitsprozess
  auslösen und Canary-/Projektionspfad prüfen.

## Freigabegates

WP1 bis WP4 sind durch die Auftraggeberfreigabe vom 2026-08-02 freigegeben.

Vor WP3: Worker-/ZIP-/Lizenzspike und Performancebudget freigeben.

Vor Produktion: OQ-18, konkreter Aufbewahrungswert, konkrete Source-Revision, EU-/Datenschutzprüfung,
vollständiger Replay sowie Eventlöschungs-/Werksresetprobe erfolgreich.
