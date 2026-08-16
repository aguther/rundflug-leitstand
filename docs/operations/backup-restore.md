# Backup und Wiederherstellung

## Aktuelle V1.12-Baseline und inkompatibler Neuaufbau

Der unterstützte Installationspfad beginnt mit `0001_v1_12_baseline.sql`. Die nachfolgenden
historischen Migrationsnotizen dokumentieren weiterhin den früheren Entwicklungsverlauf, sind aber
kein Upgradepfad für bestehende Instanzen. Alte lokale oder Cloudflare-D1-Datenbanken und portable
Backups werden nicht in die Baseline importiert. Sie werden nach verifiziertem Factory Reset
verworfen und als leere D1 in EU-Jurisdiktion neu aufgebaut; Remote-Demo-Seeds sind ausgeschlossen.

Scheitert dieser einmalige Neuaufbau, wird die neue leere D1 nochmals gelöscht und aus derselben
Baseline sowie allen eingecheckten Folgemigrationen erzeugt. Für Migrationen ab `0002` gelten die
jeweils dokumentierten Wiederherstellungs- oder Forward-Repair-Verfahren. Details stehen in
ADR-0045.

## Geplante Erweiterung 1.12 – Analysemetadaten

Nach Einführung der zugehörigen Migrationen werden `planning_chunks`, `planning_contexts`,
`planning_runs`, `analysis_archives` und `analysis_archive_events` in das portable D1-Backupregister
aufgenommen. Planungschunks, -kontexte und -läufe sind Replaygrundlage; Archivmetadaten und das getrennte
Zugriffsprotokoll sichern Lebenszyklus und Nachvollziehbarkeit. Die großen R2-Tagesarchive selbst
werden nicht in das portable JSON eingebettet.

Ein Restore erfolgt weiterhin ausschließlich in eine isolierte D1-Instanz. Danach werden alle als
`READY` markierten Archivmetadaten gegen das private R2-Objekt geprüft; ein fehlendes oder
abweichendes Objekt bleibt ein Integritätsfehler und wird nicht als leerer Download behandelt.
Tagesanalysepakete sind niemals Restore- oder Produktionsimportquellen. Details und offene
Freigaben stehen in [`analysis-packages.md`](analysis-packages.md) und ADR-0034.

## Migrationsnotiz 0067 – bestätigte Dispatch-Überholungen

Migration `0067_confirmed_dispatch_overtakes.sql` ergänzt Rotationen und Prognose-Snapshots um
einen nicht negativen, initial auf `0` gesetzten Zähler für tatsächlich durch `CALL_NEXT`
bestätigte Überholungen. Vor dem Remote-Lauf werden ein portables Backup und der
D1-Time-Travel-Zeitpunkt dokumentiert. Ein älterer Worker ignoriert die additive Spalte. Für eine
vollständige Schema-Rückkehr wird D1 per Time Travel oder aus dem unmittelbar vorherigen Backup in
eine isolierte Datenbank wiederhergestellt; ein manueller Spaltenabbau in der laufenden Datenbank
ist nicht vorgesehen.

## Migrationsnotiz 0068 – technische Buchungssegment-Reihenfolge

Migration `0068_booking_segment_order.sql` ergänzt Rotationen um eine positive technische
Segmentreihenfolge. Bestehende Werte werden einmalig aus der im append-only Verkaufsereignis
persistierten Rotationsfolge übernommen; ohne passenden Altbeleg bleibt der kompatible Wert `1`.
Vor dem Remote-Lauf werden ein portables Backup und der D1-Time-Travel-Zeitpunkt dokumentiert. Ein
älterer Worker ignoriert die additive Spalte. Für die vollständige Schema-Rückkehr gilt derselbe
Restore-Weg wie für 0067; ein manueller Spaltenabbau in der laufenden Datenbank ist nicht vorgesehen.

## Migrationsnotiz 0059 – anonyme Kassenattribution

Migration `0059_ticket_group_cashier_attribution.sql` ergänzt ausschließlich die nullable Referenz
`ticket_groups.sold_by_operator_account_id` und einen dazu passenden Suchindex. Bestehende
Ticketgruppen und Papierimporte bleiben unverändert ohne Zuordnung; es findet kein Backfill statt.
Soft-gelöschte Operator-Konten bleiben mit ihrer historischen anonymen Kennung erhalten.

Unmittelbar vor dem Remote-Lauf werden D1-Time-Travel-Zeitpunkt und portable Sicherung dokumentiert.
Ein älterer Worker kann die additive Spalte ignorieren. Falls eine vollständige Schema-Rückkehr nötig
ist, wird D1 auf den Zeitpunkt vor 0059 zurückgesetzt oder die Sicherung in eine isolierte Datenbank
eingespielt; ein manueller Tabellenneuaufbau in der laufenden Datenbank ist nicht vorgesehen.

## Historische Migrationsnotiz 0055 – aktive Gruppennachrufe

Migration `0055_ticket_group_recalls.sql` legt die Nachrufhistorie an und baut
`web_push_deliveries` mit getrennten Referenzen und Deduplizierungen für Rotation und Nachruf neu
auf. Vor dem Remote-Lauf werden D1-Time-Travel-Zeitpunkt und portables Backup dokumentiert. Bei
Fehlschlag wird nicht manuell zurückgebaut, sondern D1 auf den Zeitpunkt vor 0054 zurückgesetzt
oder das Backup in eine neue isolierte Instanz eingespielt. `ticket_group_recalls` ist Bestandteil
portabler Backups; Push-Ziele und -Zustellungen bleiben ausgeschlossen. Der ausführliche Ablauf
steht in [`migration-0055-ticket-group-recalls.md`](migration-0055-ticket-group-recalls.md).

## Migrationsnotiz 0041 – Display-Konten und FIDS-Einstellungen

Migration `0041_fids_display_accounts_and_preferences.sql` baut `operator_accounts` bei
deaktivierter Fremdschlüsselprüfung in eine strukturgleiche Tabelle mit zusätzlicher Rolle
`DISPLAY` um, kopiert alle bestehenden Konten, stellt Tabellenname und Index wieder her und legt
anschließend `fids_preferences` an. Ein automatisierter SQLite-Test prüft Bestandserhalt,
Sitzungsreferenzen, Rollen- und Werte-Checks sowie `PRAGMA foreign_key_check`.

Unmittelbar vor dem Remote-Lauf werden D1-Time-Travel-Zeitpunkt und Sicherungsstatus dokumentiert.
Bei einem fehlgeschlagenen Rollout wird zuerst die vorherige Worker-Version wiederhergestellt und
D1 per Time Travel auf den Zeitpunkt vor 0041 zurückgesetzt. Ein manueller Drop der umgebauten
Kontentabelle in der laufenden Datenbank ist unzulässig. Portable R2-Backups enthalten wie bisher
weder `operator_accounts` noch `operator_sessions` und schließen deshalb auch
`fids_preferences` bewusst aus; diese drei Tabellen werden gemeinsam über D1 Time Travel
wiederhergestellt.

## Migrationsnotiz 0031 – Gate-Anzeigefilter

Migration `0031_gate_display_filters.sql` ergänzt ausschließlich die nicht-nullbare Spalte
`gates.display_filter_json` mit dem sicheren Standard `{"productIds":[],"rotationStatuses":[]}`.
Bestehende Gates zeigen damit weiterhin alle Produkte und Umlaufstatus; Daten werden weder gelöscht
noch umgedeutet. Der Worker kann lesende Kernansichten während des additiven Migrationsfensters mit
diesem Standard bedienen. Speichern neuer Filter setzt die angewendete Migration voraus.

Vor dem Remote-Lauf werden ein portables R2-Backup und der D1-Time-Travel-Zeitpunkt kontrolliert. Bei
einem fehlgeschlagenen Worker-Rollout wird zuerst die vorherige Worker-Version wiederhergestellt.
Eine technische Down-Migration ist wegen der additiven SQLite-Spalte nicht vorgesehen; falls eine
vollständige Schema-Rückkehr erforderlich ist, wird D1 in eine isolierte Datenbank aus dem
unmittelbar vorherigen Backup beziehungsweise per Time Travel wiederhergestellt und dort geprüft.

## Migrationsnotiz 0030 – dokumentierte Manifestkorrekturen

Migration `0030_rotation_manifest_corrections.sql` ergänzt eine neue append-only Tabelle samt Index
und Update-/Delete-Sperren. Bestehende Tickets, Umläufe und Auditereignisse bleiben unverändert. Vor
dem Remote-Lauf werden ein portables R2-Backup und der D1-Time-Travel-Zeitpunkt kontrolliert. Bei
einem fehlgeschlagenen Worker-Rollout wird zuerst die vorherige Worker-Version wiederhergestellt.
Für eine vollständige Schema-Rückkehr wird D1 aus dem unmittelbar vorherigen Backup beziehungsweise
per Time Travel in eine isolierte Datenbank wiederhergestellt; die Korrekturtabelle wird nicht
manuell aus einer laufenden Datenbank entfernt.

## Migrationsnotiz 0027 – Umlaufkapazität und operative Queue

Migration `0027_rotation_capacity_queue.sql` ergänzt ausschließlich zwei nullable Spalten und einen
Index. Bestehende Fluggruppen übernehmen ihre Kommunikationsnummer als initiale operative
Sortierposition; öffentliche Kennungen werden nicht verändert. Vor dem Remote-Lauf wird ein
portabler D1-Export erstellt. Bei einem fehlgeschlagenen Worker-Rollout wird zunächst die vorherige
Worker-Version wiederhergestellt. Für eine vollständige Schema-Rückkehr oder nach bereits erfolgten
Wiedereinreihungen wird die Datenbank aus diesem Export beziehungsweise per D1 Time Travel
wiederhergestellt und anschließend mit `npm run backup:restore:test` verifiziert.

## Migrationsnotiz 0025 – Ticket-Zurückstellungen

Migration `0025_ticket_deferrals.sql` ergänzt ausschließlich zwei Spalten mit sicheren
Standardwerten (`max_ticket_deferrals = 2`, `deferral_count = 0`) und entfernt oder verändert keine
bestehenden Daten. Vor dem Remote-Lauf wird die von Wrangler/D1 erzeugte Sicherung kontrolliert.
Ein technisches Down-Migration-Skript ist wegen der additiven SQLite-Spalten nicht vorgesehen.
Falls der neue Worker nach der Migration nicht betrieben werden kann, wird zuerst der vorherige
Worker deployt; für eine vollständige Schema-Rückkehr wird D1 aus der unmittelbar vor der Migration
erzeugten Sicherung beziehungsweise per Time Travel wiederhergestellt und anschließend der
Datenbestand verifiziert.

## Ziel

- tägliche Sicherung
- mindestens 14 Tage Aufbewahrung
- zusätzliche Sicherung unmittelbar vor Veranstaltungstagen
- dokumentierter Wiederanlauf in höchstens 30 Minuten

## Implementierter Ansatz

1. D1 Time Travel als schnelle erste Wiederherstellungsebene.
2. Täglicher portabler, streamingfähiger ZIP-/NDJSON-Export aller V1-Kerntabellen nach EU-R2 unter
   `backups/YYYY-MM-DD/` im strukturierten Format `formatVersion: 2`.
3. `manifest.json` mit Pfad, Encoding und geprüfter Zeilenzahl je Tabelle; Tabellen werden in
   500-Zeilen-Seiten gelesen und ohne vollständigen Tabellen- oder Archivpuffer geschrieben.
4. Inkrementelle SHA-256-Prüfsumme über die exakten ZIP-Bytes. R2-Multipart-Upload verwendet
   5-MiB-Teile; die Prüfsumme wird nach erfolgreichem Abschluss als `<archiv>.sha256` gespeichert und
   über `customMetadata.checksumKey` referenziert.
5. Übergangsweise akzeptiert der Restore sowohl das bisherige JSON-Format 1 als auch Format 2. Der
   alte Leser bleibt bestehen, bis keine V1-Sicherung mehr in der Aufbewahrungsfrist liegt und zwei
   monatliche V2-Restore-Proben erfolgreich waren.
6. Automatisierter Restore-Test in isolierten SQLite-Datenbanken mit Prüfsummen-, Manifest-, Mengen-,
   Fremdschlüssel- und Auditkontrolle über `npm run backup:restore:test`; Bestandteil von
   `npm run check` und zusätzlich monatlich im Betriebscheck auszuführen.
7. Der tägliche Cron prüft das nächste Datum in `Europe/Berlin`. Liegt dort eine vorbereitete oder
   aktive Veranstaltung, wird der Export als `PRE_EVENT` in den R2-Metadaten gekennzeichnet.
8. Der Cron löscht Archiv und Sidecar erst nach Ablauf von 14 vollständigen Tagen.

Die portable Tabellensicherung umfasst seit Migration 0057 auch
`aircraft_product_turnaround_overrides`; die ergänzten Produkt-, Rotations- und Snapshotspalten
werden durch den vollständigen Tabellenexport automatisch erhalten. Beim Restore müssen Produkte
und aktive Ressourcengruppen-Zuordnungen vor den Flugzeug-Produkt-Ausnahmen eingespielt werden.

Stammdatenvorlagen werden als Version 2 exportiert und akzeptieren weiterhin Version 1.
Simulationspläne werden als Version 3 exportiert; Version 1 und 2 bleiben importierbar.

## Wiederanlauf

1. Betroffene Umgebung schreibsperren und Zeitpunkt dokumentieren.
2. D1 Time Travel für die schnellste Wiederherstellung prüfen.
3. Alternativ jüngstes R2-Archiv laden, das über `customMetadata.checksumKey` referenzierte Sidecar
   laden und SHA-256 über die vollständigen Archivbytes prüfen. Ein fehlendes oder abweichendes
   Sidecar sperrt den Restore.
4. Backup ausschließlich in eine neue isolierte D1-Instanz importieren; niemals die beschädigte
   Instanz direkt überschreiben.
5. Tabellen in Fremdschlüsselreihenfolge einspielen, danach Invarianten- und Mengenkontrollen
   ausführen.
6. Worker-Binding erst nach erfolgreicher Prüfung auf die wiederhergestellte D1-Instanz umstellen.
7. Ziel: Entscheidung, Restore und Umschaltung innerhalb von 30 Minuten in der Generalprobe.

## Wiederkehrender Abnahmenachweis

`npm run backup:restore:test` baut das vollständige Migrationsschema dreimal isoliert auf, erzeugt
einen synthetischen anonymen V1-Datenbestand, exportiert ihn in den portablen Formaten 1 und 2 und
stellt beide Formate getrennt wieder her. Der Lauf prüft SHA-256, V2-Tabellenmanifeste, alle
Tabellenmengen, Fremdschlüssel und das append-only Auditprotokoll und bricht oberhalb von 30 Minuten
ab. Der Vitest-Skalennachweis erzeugt zusätzlich große synthetische Bestände in
`operational_events`, `forecast_snapshots` und `outbox` und erzwingt mehrere Multipart-Teile. Vor dem
Echtbetrieb und danach monatlich wird zusätzlich ein reales R2-Objekt in eine neu angelegte isolierte
D1-Datenbank eingespielt; die produktive Datenbank wird dabei niemals überschrieben.
