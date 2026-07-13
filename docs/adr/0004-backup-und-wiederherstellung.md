# ADR-0004: Zweistufige Sicherung

- Status: Akzeptiert und umgesetzt
- Datum: 2026-07-11

## Entscheidung

D1 Time Travel dient der schnellen Wiederherstellung. Zusätzlich wird täglich und vor
Veranstaltungstagen ein portabler Export mit Prüfsumme in einem EU-R2-Bucket abgelegt. Exporte werden
mindestens 14 Tage aufbewahrt. Ein Restore in eine isolierte Datenbank wird regelmäßig getestet.

## Konsequenz

Ein Cron-Handler allein gilt nicht als erfülltes Backup. Export, Lifecycle, Restore und Nachweis müssen
implementiert und getestet werden.

## Nachweis

Der Cron erzeugt täglich einen portablen Export und kennzeichnet den Lauf automatisch als
`PRE_EVENT`, wenn am folgenden Berliner Kalendertag eine Veranstaltung ansteht. R2-Objekte bleiben
mindestens 14 vollständige Tage erhalten. `npm run backup:restore:test` führt den vollständigen
Schema-, Export- und Restore-Rundlauf mit synthetischen Daten isoliert aus und ist Teil des
Projektchecks. Das Betriebshandbuch beschreibt die Umschaltung innerhalb des 30-Minuten-Ziels.
