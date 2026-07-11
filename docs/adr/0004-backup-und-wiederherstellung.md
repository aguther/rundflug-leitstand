# ADR-0004: Zweistufige Sicherung

- Status: Akzeptiert, Umsetzung offen
- Datum: 2026-07-11

## Entscheidung

D1 Time Travel dient der schnellen Wiederherstellung. Zusätzlich wird täglich und vor
Veranstaltungstagen ein portabler Export mit Prüfsumme in einem EU-R2-Bucket abgelegt. Exporte werden
mindestens 14 Tage aufbewahrt. Ein Restore in eine isolierte Datenbank wird regelmäßig getestet.

## Konsequenz

Ein Cron-Handler allein gilt nicht als erfülltes Backup. Export, Lifecycle, Restore und Nachweis müssen
implementiert und getestet werden.
