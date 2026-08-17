# ADR-0053: Verifizierte Kompaktion der Planungshistorie in R2

- Status: Akzeptiert
- Datum: 2026-08-16
- Ergänzt: ADR-0002, ADR-0004, ADR-0034 und ADR-0052
- Betroffene Anforderungen: V1120-DIA-010, V1120-DIA-020, V1120-DIA-030,
  V1120-EXP-010, V1120-RPL-010, V1120-OPS-010, Q-PER-020, Q-ZUV-040 und T-100

## Kontext

Mehrere parallele, mehrtägige Veranstaltungen erzeugen im 30-Sekunden-Takt unveränderliche
`planning_runs` und `forecast_snapshots`. Diese Detailhistorie ist für Replay und Support wertvoll,
belastet aber die operative D1 mit Daten, die nach Ablauf ihres heißen Analysefensters nicht mehr in
jeder Board- oder Forecast-Abfrage verfügbar sein müssen. Ein bloßes Löschen würde die
Nachvollziehbarkeit verletzen; ein dauerhaft vollständiger relationaler Bestand würde D1 dagegen zum
unbegrenzten Kältespeicher machen.

ADR-0002 bleibt für den heißen operativen Zustand maßgeblich. ADR-0034 definiert support-sichere
Analysepakete, jedoch bislang weder eine rollierende Verdichtung noch einen Restore der
Planungslaufkette. Archivierung, Veranstaltungslöschung und Werksreset aus ADR-0052 müssen deshalb
auch die ausgelagerte Historie berücksichtigen.

## Entscheidung

### Geteilte Autorität und Aufbewahrung

D1 ist die Source of Truth für den heißen operativen Zustand, den Kompaktionskatalog, die
Integritätsbelege und das append-only Lebenszyklusprotokoll. Ein als `VERIFIED` katalogisiertes,
unveränderliches R2-Paket ist die autoritative Kopie des darin beschriebenen kalten
Planungshistoriensegments. Vor `VERIFIED` wird keine operative Detailzeile gelöscht.

`PLANNING_DETAIL_RETENTION_HOURS` beträgt standardmäßig und mindestens 24, höchstens 168 Stunden.
`PLANNING_HISTORY_RETENTION_YEARS` beträgt standardmäßig und mindestens fünf, höchstens zehn
Kalenderjahre. Beide Werte müssen in Produktion ausdrücklich gesetzt sein.

### Segmentgrenzen

Bei einer aktiven Veranstaltung endet ein Segment unmittelbar vor dem jüngsten mindestens
24 Stunden alten, erfolgreich oder fehlgeschlagen abgeschlossenen `ANCHOR`. Dieser Anker und alle
neueren Läufe bleiben als Fortsetzungsgrenze in D1. Ein `CAPTURING`-Lauf im Kandidatensegment
blockiert die Kompaktion. Ausschließlich `SUCCEEDED` und `FAILED` werden archiviert.

Für `CLOSED` und `ARCHIVED` wird nach Ablauf des Detailfensters auch der letzte Rest als terminales
Segment ohne Fortsetzungsanker kompaktiert. Segment- und Workflow-IDs sind deterministisch; je
Veranstaltung darf nur ein nicht terminaler Kompaktionsvorgang bestehen.

### Persistenz und Zustände

Migration `0003_planning_history_compaction.sql` führt ein:

- `planning_history_compactions` als Katalog für Grenzen, Objekt, Prüfsumme, Mengen, Version,
  Retention und Fortsetzungsbeleg,
- `planning_history_compaction_events` als append-only Protokoll,
- `planning_history_maintenance_control` als standardmäßig inaktiven, auf genau eine Veranstaltung
  und Boundary begrenzten Wächter.

Der Lebenszyklus lautet `PENDING → BUILDING → VERIFIED → PRUNING → COMPLETED`. Fehler, Ablauf und
explizite Löschung werden als `FAILED`, `EXPIRED` beziehungsweise `DELETED` protokolliert. Der
Wächter lockert die append-only Trigger nur für die exakt katalogisierte Boundary-Reparatur und die
begrenzte Löschung. Operatives Ledger, Idempotenz, Outbox und Veranstaltungsversion bleiben
unverändert.

### Paket und Integrität

Das Format `rundflug-planning-history` Version 1 ist ein ZIP mit `manifest.json`,
`continuation.json` und NDJSON für Runs, Contexts, Chunks und Forecast-Snapshots. Jede NDJSON-Datei
trägt Zeilenzahl, Bytezahl und SHA-256 im Manifest; das gesamte ZIP besitzt eine separate
SHA-256-Sidecar-Datei. Es enthält ausschließlich `SUPPORT_SAFE`-Projektionen.

Objektschlüssel folgen
`planning-history/<event-id>/<event-date>/<compaction-id>.zip`. Ein vorhandenes ZIP wird nie
überschrieben. Bei einer Unterbrechung zwischen ZIP- und Sidecar-Upload wird das vorhandene Objekt
erneut gelesen und gehasht und nur der fehlende Beleg ergänzt. Erst der vollständige R2-Download mit
passender Prüfsumme erlaubt `VERIFIED`.

### Orchestrierung und Pruning

`PlanningHistoryCompactionWorkflow` verarbeitet genau ein Segment in wiederaufnehmbaren Schritten.
Ein stündlicher Cron wählt Veranstaltungen fair aus und startet höchstens 100 idempotente
Workflow-Instanzen je Batch. Der tägliche Wartungslauf übernimmt zusätzlich Retention.

Pruning ist wiederaufnehmbar. Eine D1-Transaktion löscht höchstens 10.000 Snapshots, 500 Runs,
250 Contexts oder 500 Chunks. Shared Contexts und Chunks sind im Paket enthalten, werden aber erst
gelöscht, wenn keine heiße Referenz mehr existiert. Die Fortsetzungslinks werden vor der Löschung
kontrolliert gelöst und sind im Katalog für Restore und Prüfung erhalten.

### Analysepaket und Restore

Neue Tagesanalysearchive verwenden Format 2. Sie betten alle bereits kompaktierten Pakete mit ihrem
Kataloghash ein und ergänzen nur den heißen D1-Rest. Replay prüft äußeren und inneren Hash,
Dateimengen und Boundary-Belege und vereinigt IDs ohne Dubletten. Format 1 bleibt lesbar.

Ein Restore erfolgt ausschließlich in einer isolierten D1: portables Backup einspielen, Pakete
chronologisch prüfen und laden, Boundary-Links rekonstruieren, Mengen und Fremdschlüssel prüfen und
Replay ausführen. Erst nach diesem Nachweis darf ein Worker-Binding bewusst umgestellt werden. Ein
technischer SQL-Rückbau von Migration `0003` in einer laufenden D1 ist ausgeschlossen; zulässig ist
Forward-Repair oder Wiederherstellung in eine neue D1.

Veranstaltungslöschung und Werksreset löschen zusätzlich den R2-Präfix sowie Katalog und Ereignisse.
Die Anwendungslöschung bleibt führend; ein R2-Lifecycle dient nur als Sicherheitsnetz.

## Konsequenzen

- Die operative D1 bleibt auf ein begrenztes Detailfenster ausgerichtet, ohne Replay-Historie zu
  verlieren.
- R2 und D1-Katalog bilden gemeinsam einen prüfpflichtigen Archivverbund; ein einzelnes R2-Objekt
  ohne Katalog und Integritätsbeleg gilt nicht als wiederherstellbare Historie.
- Die Kompaktion ist absichtlich kein öffentlicher Importpfad und erhält keine neue HTTP-Route oder
  Benutzeroberfläche.
- Portable Backups enthalten Katalog und Ereignisse, niemals einen aktiven Maintenance-Control-
  Zustand.
- Der vollständige Lastnachweis umfasst drei parallele 72-Stunden-Veranstaltungen mit je 300
  Umläufen und prüft Detailfenster, Mengenbilanz, terminale Kompaktion, Speicher und Forecast-p95.
  Die absolute Zwei-Sekunden-Latenzgrenze wird gegen monotone Wandzeit gemessen. Die relative
  Zehn-Prozent-CPU-Grenze verwendet die Prozess-CPU-Zeit der gleich großen indexierten
  Snapshot-Lookup-Stichprobe. Damit misst sie genau den durch die Kompaktion veränderbaren Anteil,
  während Betriebssystem-Scheduling und der identische synthetische Forecast-Rechenkern keine
  vermeintliche Datenbankregression erzeugen.

## Verworfene Alternativen

- **D1 unbegrenzt wachsen lassen:** verschiebt Kosten und Query-Risiko ohne zusätzlichen
  Nachweisnutzen.
- **Nur Forecast-Snapshots löschen:** zerreißt Replay- und Laufmengen und lässt große Kontexte ohne
  überprüfbare Segmentgrenze zurück.
- **R2 hochladen und sofort löschen:** besitzt kein Download-/Hash-Gate und kann bei einem
  erfolgreichen Upload-Response mit beschädigtem oder falschem Objekt Daten verlieren.
- **Restore direkt in Produktion:** vermischt Prüfung und Wiederinbetriebnahme und kann bestehende
  Daten irreversibel überschreiben.
- **Ein Workflow für alle Veranstaltungen:** erschwert Fairness, Wiederaufnahme und eine klar
  begrenzte Fehlerdomäne.
