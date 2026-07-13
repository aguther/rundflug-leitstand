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

## 0004 – Geräte-Credentials

Ergänzt den SHA-256-Hash eines zufälligen Geräte-Tokens. Bestehende Geräte müssen nach der Migration
neu gekoppelt werden, bevor sie schreiben dürfen; ein leerer Hash wird abgelehnt. Wiederherstellung
erfolgt aus der Sicherung vor Migration. Tokens selbst werden weder in D1 noch in Logs gespeichert.

## 0005 – Notfall, Unterbrechung und Korrektur

Erweitert Geräte um die Rolle Flugleitung, ergänzt den Rücknahmezeitpunkt eines Aufrufs und führt
historisierte betriebliche Blockierungen ein. Vor Anwendung ist eine Sicherung verpflichtend. Der
Tabellenneuaufbau von `paired_devices` wird zuerst in Acceptance geprüft; Wiederherstellung erfolgt
aus der Sicherung. Bestehende Credentials werden unverändert als Hash übernommen.

## 0013 – Optionaler Anwesenheitsabgleich

Ergänzt Tickets ausschließlich um den technischen Anwesenheitsstatus `NOT_CHECKED_IN` oder
`CHECKED_IN`. Bestehende Tickets beginnen neutral als nicht eingecheckt; Namen, Telefonnummern oder
andere Gastdaten werden nicht ergänzt. Vor Anwendung wird eine D1-/R2-Sicherung erzeugt.
Wiederherstellung erfolgt aus dieser Sicherung, da SQLite die Spalte nicht ohne Tabellenneuaufbau
entfernen kann.

## 0014 – Veranstaltungsparameter

Ergänzt additive, nicht personenbezogene Konfigurationsfelder für Verkaufsbeginn, Fristen,
Referenzgewichte und Planprozesszeiten. Bestehende Veranstaltungen erhalten dokumentierte
Standardwerte. Vor Anwendung wird eine portable Sicherung erstellt; Wiederherstellung erfolgt aus
dieser Sicherung, da ein spaltenweiser Rückbau einen SQLite-Tabellenneuaufbau erfordern würde.

## 0015 – Produkt- und Gate-Stammdaten

Führt Gates sowie additive Produktfelder für Kürzel, öffentliche Beschreibung, Begleitpflicht,
Gewichtsklassen und Sortierung ein. Bestehende Veranstaltungen erhalten ein synthetisches Haupt-Gate;
Produktkürzel werden deterministisch aus internen IDs abgeleitet. Vor Anwendung wird gesichert.
Wiederherstellung erfolgt aus der Sicherung, weil Spalten und Gate-Bezüge nicht verlustfrei einzeln
zurückgebaut werden können.

## 0016 – Ressourcen- und Flugzeugstammdaten

Ergänzt Ressourcengruppen um Kapazität, Planumlaufzeit und kompatible Flugzeugtypen sowie Flugzeuge
um die optionale maximale Passagierzuladung. Zuordnungshistorien erhalten Änderungsgrund und Gerät.
Die bestehende partielle Eindeutigkeitsregel verhindert weiterhin zwei aktive Ressourcengruppen je
Flugzeug. Vor Anwendung wird gesichert; Wiederherstellung erfolgt aus der portablen Sicherung.

## 0017 – Mehrveranstaltungsbetrieb und Vorlagen

Ergänzt Veranstaltungen um Flugplatz, Archivzeitpunkt und den nachvollziehbaren Bezug zur kopierten
Vorveranstaltung. Die Änderung ist additiv; vor Anwendung wird dennoch eine portable Sicherung
erstellt. Wiederherstellung erfolgt aus dieser Sicherung, da D1 Spalten nicht einzeln zurückrollt.

## 0018 – Plan-, Prognose- und Ist-Zeitleisten

Ergänzt Umläufe um getrennte Plan- und Prognosezeitpunkte; die vorhandenen Primärzeitstempel bleiben
die unveränderten Ist-Werte. Prognose-Snapshots dokumentieren die Entwicklung je Event-Version.
Vor Anwendung wird eine portable Sicherung erzeugt. Wiederherstellung erfolgt aus dieser Sicherung,
weil additive D1-Spalten nicht einzeln zurückgebaut werden.

## 0019 – Geregelte Nacherfassung nach Totalausfall

Führt append-only-nahe Nacherfassungsbatches und geordnete Papierbelege mit Vorsimulation,
Konfliktstatus und späterem Vier-Augen-Bezug ein. Das Ereignisledger erhält ausschließlich additive
Metadaten für ursprüngliche Ereigniszeit, Batch und anonymen Papierbezug; Namen oder Telefonnummern
werden nicht eingeführt. Vor Anwendung wird ein portables Backup erstellt. Wiederherstellung erfolgt
aus diesem Backup, da D1 die additiven Ledger-Spalten nicht einzeln zurückbauen kann.

## 0020 – Anonyme Papierbezug-Zuordnung

Ordnet eine nicht personenbezogene Papier-Belegreferenz nach erfolgreicher Anwendung genau einer
Ticketgruppe und einem Umlauf zu. Dadurch können Kassen- und Flight-Line-Nacherfassung in getrennten,
rollenrichtigen Batches fortgesetzt werden. Der aktuelle Zuordnungszustand ist ein technischer Index;
die unveränderliche Historie bleibt im Ereignisledger. Vor Anwendung wird portabel gesichert;
Wiederherstellung erfolgt aus dieser Sicherung.

## 0021 – Deduplizierte Web-Push-Zustellaufträge

Ergänzt eine Zustellqueue für freiwillige, ticketbezogene Web-Push-Hinweise. Die eindeutige
Kombination aus Abonnement, Umlauf und Hinweistyp verhindert doppelte Vorab- oder Aufrufmeldungen.
Zustellaufträge werden über Fremdschlüssel zusammen mit dem befristeten Push-Abonnement gelöscht und
bewusst nicht in portable operative Backups aufgenommen. Ein Rollback kann die neue Tabelle und den
Index entfernen; bereits versendete Browsermeldungen lassen sich naturgemäß nicht zurückrufen.

## 0022 – Organisatorische Bemerkung zum Pilotencode

Ergänzt am anonymen, veranstaltungsbezogenen Pilotencode eine optionale organisatorische Bemerkung.
Die Oberfläche weist ausdrücklich darauf hin, dort keine Namen oder Lizenzdaten zu erfassen. Vor
Anwendung wird portabel gesichert. Wiederherstellung erfolgt aus dieser Sicherung, da D1 additive
Spalten nicht einzeln zurückrollt; ältere Anwendungen können die neue Spalte gefahrlos ignorieren.

## 0023 – Aktueller anonymer Pilotencode je Veranstaltungsflugzeug

Ergänzt die veranstaltungsbezogene aktive Flugzeugzuordnung additiv um den zuletzt mit `NEXT`
bestätigten anonymen Pilotencode. Dadurch kann der Leitstand diesen Code beim nächsten Umlauf dieses
Flugzeugs vorrangig vorschlagen; ein bewusster Wechsel bleibt möglich und wird auditiert. Es werden
keine Namen oder Lizenzdaten gespeichert. Vor Anwendung wird eine portable Sicherung erzeugt.
Wiederherstellung erfolgt aus dieser Sicherung; ältere Anwendungen können die nullable Spalte und den
partiellen Index gefahrlos ignorieren.

## 0024 – Einmalige Ersteinrichtung

Führt einen Singleton-Guard für die atomare erste Anlage von Veranstaltung und anonymem
Administrationsgerät ein. Der Guard verhindert auch bei parallelen Anfragen eine zweite
Ersteinrichtung. Die Tabelle enthält ausschließlich technische IDs und den Abschlusszeitpunkt. Vor
Anwendung wird portabel gesichert. Ein Rollback erfolgt aus dieser Sicherung; der Guard darf nach
erfolgreichem Produktiv-Bootstrap nicht isoliert entfernt werden.

## 0026 – Historisches Umlauf-Gate und organisatorische Bemerkung

Ergänzt Umläufe additiv um das beim Anlegen wirksame Gate und eine optionale organisatorische
Bemerkung. Bestehende Umläufe werden zuerst über ihr Produkt, ersatzweise über die Ressourcengruppe,
einem Gate zugeordnet. Die Bemerkung beginnt leer und darf keine Namen oder anderen Personendaten
enthalten. Vor Anwendung wird eine portable Sicherung erzeugt. Wiederherstellung erfolgt aus dieser
Sicherung, da D1 additive Spalten nicht einzeln zurückrollt; ältere Anwendungen können beide Spalten
gefahrlos ignorieren.
