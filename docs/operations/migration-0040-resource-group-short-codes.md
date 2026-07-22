# Migration 0040 – Ressourcengruppen-Kurzzeichen

## Zweck und Datenwirkung

`0040_resource_group_short_codes.sql` ergänzt `resource_groups.short_code`. Bestehende Gruppen
erhalten je Veranstaltung anhand von Anlagezeit und technischer ID deterministisch `RG001`, `RG002`
und fortlaufend. Ein eindeutiger Index verhindert doppelte Kürzel innerhalb einer Veranstaltung.
Neue und geänderte Stammdaten akzeptieren ausschließlich zwei bis acht Großbuchstaben, Ziffern oder
Bindestriche. Die Migration speichert keine personenbezogenen oder flugbetrieblichen Freigabedaten.

## Backup, Anwendung und Prüfung

1. Unmittelbar vorher ein portables D1-/R2-Backup sowie den D1-Time-Travel-Zeitpunkt dokumentieren.
2. Die Migration zuerst in der Abnahmeumgebung anwenden.
3. Prüfen, dass jede Ressourcengruppe ein nicht leeres und je Veranstaltung eindeutiges Kurzzeichen
   besitzt und der Operations-Endpunkt es an Gruppe und Flugzeug ausliefert.
4. Im Admin-Editor ein Kürzel ändern und die kompakte Flight-Line-Darstellung prüfen.

## Wiederherstellung

Ein isolierter Spaltenrückbau ist wegen des dafür nötigen SQLite-Tabellenneuaufbaus nicht
vorgesehen. Bei fehlerhaftem Backfill wird eine isolierte Datenbank per D1 Time Travel auf den
dokumentierten Zeitpunkt gesetzt oder aus dem portablen Backup wiederhergestellt, vollständig
geprüft und erst danach umgeschaltet. Ältere Worker ignorieren die additive Spalte.
