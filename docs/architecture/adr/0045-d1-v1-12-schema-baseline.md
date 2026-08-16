# ADR-0045: Inkompatible D1-Schema-Baseline für V1.12

- Status: Akzeptiert
- Datum: 2026-08-15
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: V1100-MIG-010, V1110-MIG-010

## Kontext

Vor dem ersten Produktivbetrieb bestand die D1-Historie aus 69 Entwicklungs- und
Abnahmemigrationen. Sie enthielt eine historische Doppelnummer `0036`, zahlreiche inzwischen
überholte Umbauten und Backfills sowie Tests, die SQL-Text statt das resultierende Verhalten
prüften. Da keine produktiven Daten erhalten werden müssen, ist ein kompatibler Upgradepfad für
diese Historie weder erforderlich noch erwünscht.

## Entscheidung

Die aktive D1-Historie beginnt neu mit `0001_v1_12_baseline.sql`. Die Baseline wurde aus einer
SQLite-Datenbank abgeleitet, auf die alle 69 bisherigen Migrationen in ihrer bisherigen Reihenfolge
angewendet wurden. Sie beschreibt das konsolidierte V1.12-Endschema mit 42 Anwendungstabellen,
73 benannten Indizes und 20 Triggern. Historische Backfills und die Wrangler-interne Tabelle
`d1_migrations` sind nicht enthalten. Der technische Singleton `system_reset_control` wird mit dem
sicheren inaktiven Wert initialisiert, weil Append-only-Trigger und Resetabläufe ihn voraussetzen.

Die bisherigen SQL-Dateien bleiben ausschließlich über Git nachvollziehbar. Bestehende lokale und
Cloudflare-D1-Instanzen werden nicht migriert, sondern nach dem dokumentierten Reset vollständig
verworfen und frisch aus der Baseline erzeugt. Der Verlust sämtlicher Entwicklungs- und
Abnahmedaten ist ausdrücklich zulässig. Portable Backups aus der alten Historie dienen nicht als
Importquelle für die neue Baseline.

Nachfolgende Änderungen sind vorwärtsgerichtete Migrationen mit eindeutiger, lückenloser Nummer.
Die erste davon ist `0002_planning_run_lineage_indexes.sql`; sie ergänzt die beiden direkten
Lineage-Indizes auf `planning_runs.previous_run_id` und `planning_runs.anchor_run_id`, die D1 für die
skalierbare Werksreset-Löschung benötigt. Angewandte Dateien werden niemals nachträglich
umbenannt oder verändert. Jede neue Migration benötigt eine Wiederherstellungs- oder
Forward-Repair-Notiz und einen Test, der sie ausführt und ihr beobachtbares Schema- oder
Fachverhalten prüft.

## Verifikation

Ein semantisches Manifest hält Tabellen, Spalten, Defaults, Primär- und Fremdschlüssel, Indizes und
Trigger fest. Der Baseline-Test führt das SQL in einer echten In-Memory-SQLite-Datenbank mit
aktivierten Fremdschlüsseln aus und vergleicht die SQLite-Introspektion vollständig mit diesem
Manifest. Zusätzlich prüft er `PRAGMA foreign_key_check`, den Ausschluss von `d1_migrations`, die
Datenschutzspalten und die zugesagten 20-/30-Minuten-Produkte aus dem synthetischen Demo-Seed.

## Folgen und Wiederherstellung

- Eine bestehende Installation kann nicht in-place auf diese Baseline aktualisiert werden.
- Vor dem Neuaufbau wird ein administrativer Factory Reset einschließlich Durable Objects und R2
  ausgeführt und verifiziert; danach wird die alte D1 gelöscht und unter demselben Namen in
  EU-Jurisdiktion neu angelegt.
- Remote werden alle ausstehenden, eingecheckten Migrationen und der Worker ausgerollt, niemals
  Demo-Daten.
- Scheitert der Neuaufbau vor der Abnahme, wird die neue leere D1 erneut gelöscht und aus derselben
  Baseline aufgebaut. Die alte Nutzdateninstanz wird nicht wiederhergestellt.
- Historische ADRs und Migrationsnotizen bleiben als Entscheidungsverlauf erhalten; für den aktuell
  unterstützten Installationspfad gilt dieser ADR.

## Verworfene Alternativen

- **Die 69 Dateien lediglich neu nummerieren:** erhält veraltete Backfills und erzeugt eine neue,
  schwer prüfbare Identität für denselben historischen Ablauf.
- **Die Doppelnummer als dauerhafte Ausnahme behalten:** verhindert die gewünschte eindeutige und
  lückenlose Nummerierung zukünftiger Migrationen.
- **Eine Upgrade-Migration von der alten Historie anbieten:** erzeugt einen nicht benötigten zweiten
  Installationspfad und erhöht Test- und Wiederherstellungsrisiko vor dem ersten Produktivbetrieb.
