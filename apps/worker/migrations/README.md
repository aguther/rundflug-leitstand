# Migrationen

`0001_initial.sql` ist ein bewusst breites, aber noch nicht fachlich vollständiges Startschema. Jede
Folgemigration benötigt eine Wiederherstellungsnotiz. Produktive Migrationen werden zuerst in der
Abnahmeumgebung und gegen eine aktuelle Sicherung geprüft.

## 0002 – Geräteidentität

Führt ausschließlich die additive Tabelle `paired_devices` ein. Wiederherstellung: vor Anwendung
D1-/R2-Sicherung erzeugen; bei Abbruch auf diese Sicherung zurücksetzen. Ein Rückbau per `DROP TABLE`
ist im laufenden Betrieb unzulässig, weil Gerätebezüge aus späteren Audit-Ereignissen erhalten bleiben
müssen.

## 0003 – Erster Vertical Slice

Ergänzt additive Produkt-, Zahlungs- und Flugzeugstatusfelder sowie einen Umlaufindex. Vor Anwendung
ist eine portable Sicherung erforderlich. Wiederherstellung erfolgt aus dieser Sicherung; SQLite kann
die ergänzten Spalten nicht ohne Tabellenneuaufbau zurücknehmen. Es werden keine Telefonnummern oder
Gastnamen eingeführt.
