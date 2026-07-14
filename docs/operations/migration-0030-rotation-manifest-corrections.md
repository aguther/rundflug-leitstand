# Migration 0030 – administrative Besetzungskorrekturen

Betroffene Anforderung: F-SLT-040.

Die Migration ergänzt ausschließlich die append-only Tabelle
`rotation_manifest_corrections`. Sie speichert anonyme technische IDs, Begründung, Zeitpunkt,
Administrationsgerät und Eventversion. Normale Dispositionskommandos bleiben ab `IN_FLIGHT`
gesperrt.

## Einspielen

Vor dem Einspielen ist ein portables R2-Backup zu erstellen. Danach wird die Migration mit dem
regulären D1-Migrationskommando angewendet und der Migrationsstatus kontrolliert. Es sind keine
Bestandsdaten umzuschreiben.

## Wiederherstellung

Die Migration ist absichtlich vorwärtsgerichtet. Bei einem Fehler wird nicht versucht, die neue
Tabelle in der laufenden Datenbank zu entfernen. Stattdessen wird der vor der Migration erzeugte
D1-/R2-Stand in eine neue D1-Datenbank wiederhergestellt und die Worker-Bindung auf diesen geprüften
Stand zurückgesetzt. Dadurch bleiben alte Audit- und Ticketdaten unverändert erhalten.

Ein Werksreset darf die Korrekturtabelle nur innerhalb des bereits geschützten Reset-Vorgangs
leeren. Portable Sicherungen enthalten die Tabelle in fremdschlüsselkompatibler Reihenfolge.
