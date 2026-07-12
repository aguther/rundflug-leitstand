# Backup und Wiederherstellung

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
4. monatlicher automatisierter Restore-Test in einer isolierten Testdatenbank.
5. manueller Pre-Event-Backup-Check in der Aufbaucheckliste.

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

## Offener Abnahmenachweis

Der Export und die 14-Tage-Lifecycle-Regel sind implementiert. Der isolierte Remote-Restore und die
30-Minuten-Messung benötigen eingerichtete Acceptance-D1-/R2-Ressourcen und werden dort abgenommen.
