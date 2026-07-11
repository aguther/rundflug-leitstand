# Backup und Wiederherstellung – Arbeitsstand

## Ziel

- tägliche Sicherung
- mindestens 14 Tage Aufbewahrung
- zusätzliche Sicherung unmittelbar vor Veranstaltungstagen
- dokumentierter Wiederanlauf in höchstens 30 Minuten

## Geplanter Ansatz

1. D1 Time Travel als schnelle erste Wiederherstellungsebene.
2. Regelmäßiger portabler D1-Export nach EU-R2.
3. Prüfsumme und Metadaten je Export.
4. monatlicher automatisierter Restore-Test in einer isolierten Testdatenbank.
5. manueller Pre-Event-Backup-Check in der Aufbaucheckliste.

## Status

Das Repository enthält nur die Datenstrukturen und Cron-Schnittstelle. Export, Lifecycle-Regeln,
Restore-Automation und Nachweis sind noch zu implementieren und abzunehmen.
