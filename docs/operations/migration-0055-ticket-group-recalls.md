# Migration 0055 – aktive Gruppennachrufe

`0055_ticket_group_recalls.sql` ergänzt die append-only Historie temporärer Nachrufe und baut die
Push-Zustelltabelle so um, dass Rotationshinweise und gruppenspezifische Nachrufe jeweils einen
eindeutigen fachlichen Bezug besitzen.

## Vor dem Rollout

1. D1-Time-Travel-Zeitpunkt und letztes portables Backup dokumentieren.
2. Sicherstellen, dass kein paralleles Schema-Rollout läuft.
3. Migration zunächst in einer isolierten Kopie anwenden und `PRAGMA foreign_key_check` prüfen.
4. Worker 1.11.0 erst nach erfolgreich angewandter Migration bereitstellen.

## Wiederherstellung

Die Migration baut `web_push_deliveries` kontrolliert neu auf und kopiert alle bestehenden
Rotationszustellungen. Eine manuelle Down-Migration in der laufenden Datenbank ist nicht vorgesehen.
Bei einem fehlgeschlagenen Rollout wird zuerst die vorherige Worker-Version bereitgestellt und D1
per Time Travel auf den dokumentierten Zeitpunkt vor 0054 zurückgesetzt. Alternativ wird das
unmittelbar vorherige vollständige Backup in eine neue isolierte D1-Instanz eingespielt und mit
`npm run backup:restore:test` geprüft.

`ticket_group_recalls` gehört zum portablen Backup. Push-Abonnements und -Zustellungen bleiben wie
bisher aus Datenschutzgründen ausgeschlossen.
