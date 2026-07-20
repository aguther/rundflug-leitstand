# Migration 0038 – Zeitpunkt des Flugzeug-Zustandswechsels

## Zweck und Datenwirkung

`0038_aircraft_state_changed_at.sql` ergänzt die nullable Textspalte
`aircraft.operational_state_changed_at`. Der Backfill verwendet zuerst das jüngste zuordenbare
append-only Status- oder Umlaufereignis, danach den jüngsten Ist-Zeitpunkt eines Umlaufs und zuletzt
`aircraft.updated_at`. Die Migration speichert keine Personen- oder Freigabedaten.

Nach der Migration setzen neue Flugzeuge den Wert bei der Anlage. Operative Statuspfade schreiben
ihn nur dann neu, wenn sich `operational_state` tatsächlich ändert. Stammdaten, Tankvormerkung,
Schwellwerte und reine Zähleraktualisierungen lassen ihn unverändert.

## Backup und Anwendung

1. Unmittelbar vor der Migration ein portables D1-/R2-Backup und den D1-Time-Travel-Zeitpunkt
   dokumentieren.
2. Migration zuerst in der Abnahmeumgebung anwenden.
3. Prüfen, dass kein Bestandsflugzeug einen leeren Zeitpunkt besitzt und der Operations-Endpunkt das
   Pflichtfeld `operationalStateChangedAt` liefert.
4. Eine reine Stammdatenänderung durchführen und bestätigen, dass der Zeitpunkt unverändert bleibt.

## Wiederherstellung

Ein isolierter Spaltenrückbau ist nicht vorgesehen, weil SQLite dafür einen Tabellenneuaufbau
benötigt und ältere Worker die neue Spalte gefahrlos ignorieren können. Bei fehlgeschlagenem Backfill
oder notwendiger vollständiger Rückkehr wird eine isolierte Datenbank per D1 Time Travel auf den
dokumentierten Zeitpunkt gesetzt oder aus dem portablen Backup wiederhergestellt, geprüft und erst
danach umgeschaltet.
