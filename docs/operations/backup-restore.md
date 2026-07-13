# Backup und Wiederherstellung

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
2. Täglicher portabler JSON-Export aller V1-Kerntabellen nach EU-R2 unter `backups/YYYY-MM-DD/`.
3. SHA-256-Prüfsumme als R2-Custom-Metadata und strukturiertes Format `formatVersion: 1`.
4. automatisierter Restore-Test in zwei isolierten SQLite-Datenbanken mit Prüfsummen-, Mengen-,
   Fremdschlüssel- und Auditkontrolle über `npm run backup:restore:test`; Bestandteil von
   `npm run check` und zusätzlich monatlich im Betriebscheck auszuführen.
5. Der tägliche Cron prüft das nächste Datum in `Europe/Berlin`. Liegt dort eine vorbereitete oder
   aktive Veranstaltung, wird der Export als `PRE_EVENT` in den R2-Metadaten gekennzeichnet.
6. Der Cron löscht Objekte erst nach Ablauf von 14 vollständigen Tagen.

## Wiederanlauf

1. Betroffene Umgebung schreibsperren und Zeitpunkt dokumentieren.
2. D1 Time Travel für die schnellste Wiederherstellung prüfen.
3. Alternativ jüngstes R2-Objekt laden und SHA-256 gegen `customMetadata.sha256` prüfen.
4. Backup ausschließlich in eine neue isolierte D1-Instanz importieren; niemals die beschädigte
   Instanz direkt überschreiben.
5. Tabellen in Fremdschlüsselreihenfolge einspielen, danach Invarianten- und Mengenkontrollen
   ausführen.
6. Worker-Binding erst nach erfolgreicher Prüfung auf die wiederhergestellte D1-Instanz umstellen.
7. Ziel: Entscheidung, Restore und Umschaltung innerhalb von 30 Minuten in der Generalprobe.

## Wiederkehrender Abnahmenachweis

`npm run backup:restore:test` baut das vollständige Migrationsschema zweimal isoliert auf, erzeugt
einen synthetischen anonymen V1-Datenbestand, exportiert ihn im portablen Format und stellt ihn in
die zweite Datenbank wieder her. Der Lauf prüft SHA-256, alle Tabellenmengen, Fremdschlüssel und das
append-only Auditprotokoll und bricht oberhalb von 30 Minuten ab. Vor dem Echtbetrieb und danach
monatlich wird zusätzlich ein reales R2-Objekt in eine neu angelegte isolierte D1-Datenbank
eingespielt; die produktive Datenbank wird dabei niemals überschrieben.
