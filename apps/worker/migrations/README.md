# Migrationen

`0001_initial.sql` ist ein bewusst breites, aber noch nicht fachlich vollständiges Startschema. Jede
Folgemigration benötigt eine Wiederherstellungsnotiz. Produktive Migrationen werden zuerst in der
Abnahmeumgebung und gegen eine aktuelle Sicherung geprüft.

## 0001 – Initialschema

Legt das initiale relationale Schema an. Es wird ausschließlich auf einer leeren Datenbank
angewendet. Wiederherstellung: fehlgeschlagene Erstbereitstellung verwerfen und eine neue leere D1
anlegen; niemals eine produktiv befüllte Datenbank durch erneute Anwendung reparieren.

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

Erweitert Geräte um die Rolle Flight Director, ergänzt den Rücknahmezeitpunkt eines Aufrufs und führt
historisierte betriebliche Blockierungen ein. Vor Anwendung ist eine Sicherung verpflichtend. Der
Tabellenneuaufbau von `paired_devices` wird zuerst in Acceptance geprüft; Wiederherstellung erfolgt
aus der Sicherung. Bestehende Credentials werden unverändert als Hash übernommen.

## 0009 bis 0012 – Betriebs-, Ressourcen-, Unterbrechungs- und Pilotenergänzungen

Die vier additiven Migrationen erweitern Flugzeug-, Ressourcengruppen-, Veranstaltungs- und
Pilotenzustände. Vor Anwendung ist eine portable Sicherung erforderlich. Wiederherstellung erfolgt
aus dieser Sicherung beziehungsweise per D1 Time Travel; ein isoliertes Entfernen der Spalten würde
einen SQLite-Tabellenneuaufbau erfordern.

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

## 0025 – Ticket-Zurückstellungen

Ergänzt additive Grenzen und Zähler für bewusste Zurückstellungen. Vor Anwendung wird portabel
gesichert. Wiederherstellung erfolgt aus dieser Sicherung beziehungsweise per D1 Time Travel, weil
ein spaltenweiser Rückbau einen Tabellenneuaufbau erfordern würde.

## 0026 – Historisches Umlauf-Gate und organisatorische Bemerkung

Ergänzt Umläufe additiv um das beim Anlegen wirksame Gate und eine optionale organisatorische
Bemerkung. Bestehende Umläufe werden zuerst über ihr Produkt, ersatzweise über die Ressourcengruppe,
einem Gate zugeordnet. Die Bemerkung beginnt leer und darf keine Namen oder anderen Personendaten
enthalten. Vor Anwendung wird eine portable Sicherung erzeugt. Wiederherstellung erfolgt aus dieser
Sicherung, da D1 additive Spalten nicht einzeln zurückrollt; ältere Anwendungen können beide Spalten
gefahrlos ignorieren.

## 0027 – Operative Queue-Position und nutzbare Umlaufkapazität

Trennt die veränderliche operative Reihenfolge von der stabilen Kommunikationsnummer und ergänzt
eine optionale, vor dem Aufruf reduzierte nutzbare Kapazität am konkreten Umlauf. Bestehende
Fluggruppen erhalten ihre bisherige Kommunikationsnummer als initiale Sortierposition; dadurch
bleibt ihre Reihenfolge unverändert. Vor Anwendung wird eine portable D1-Sicherung erzeugt.
Wiederherstellung erfolgt aus dieser Sicherung beziehungsweise per D1 Time Travel, weil die beiden
additiven Spalten nicht ohne Tabellenneuaufbau entfernt werden können. Ein älterer Worker kann die
nullable Spalten übergangsweise ignorieren, darf nach einer bereits vorgenommenen manuellen
Wiedereinreihung aber nicht dauerhaft weiterbetrieben werden.

## 0029 – Nachvollziehbare Prognosedatengrundlage

Ergänzt Prognose-Snapshots additiv um den auslösenden fachlichen Ereignistyp, den verwendeten
Historienbezug, Stichprobengröße und Datenalter sowie aktive Kapazität und Referenzdauer. Bestehende
Snapshots werden ausdrücklich als `LEGACY_UNKNOWN` gekennzeichnet und bleiben unverändert
auswertbar. Vor Anwendung wird eine portable D1-Sicherung erzeugt. Wiederherstellung erfolgt aus
dieser Sicherung beziehungsweise per D1 Time Travel; ältere Worker dürfen nach der Migration keine
neuen Snapshots mehr schreiben, weil ihnen die vollständige Datengrundlage fehlt.

## 0030 bis 0032 – Manifestkorrekturen, FIDS-Filter und Reset-Prognosen

Die drei Migrationen ergänzen Korrekturbezüge, gespeicherte FIDS-Filter und die vollständige
Bereinigung von Prognose-Snapshots beim Werksreset. Vor Anwendung ist eine portable Sicherung
beziehungsweise D1-Time-Travel-Marke erforderlich. Wiederherstellung erfolgt ausschließlich daraus;
ein partieller Rückbau darf Audit- oder Resetkonsistenz nicht schwächen.

## 0033 – Kurzlebige anonyme Flight-Line-Betreuung

Führt eine rein technische, auslaufende Gerätereservierung je Veranstaltungsflugzeug ein. Sie
verhindert, dass zwei Assist-Geräte unbemerkt dasselbe Flugzeug betreuen, speichert aber weder Namen
noch andere personenbezogene Daten und besitzt keine Freigabewirkung. Ein Rollback kann Tabelle und
Index entfernen; vor Anwendung wird dennoch eine portable D1-Sicherung empfohlen. Beim Werksreset
und beim Löschen der Veranstaltung werden alle Reservierungen entfernt.

## 0034 – Automatischer Voraufruf

Ergänzt Veranstaltung und Ressourcengruppen um verständliche Voraufruf-Parameter sowie
Fluggruppen um den getrennten, technischen Zustand `precalled_at`. Der Voraufruf bindet kein
Flugzeug und ersetzt weder `NEXT` noch eine menschliche operative Bestätigung. Jeder automatische
Voraufruf erzeugt einen append-only Audit-Eintrag mit dem technischen Auslöser
`AUTOMATIC_PRECALL`. Vor Anwendung ist eine portable D1-Sicherung erforderlich; ein Rollback
erfolgt aus dieser Sicherung beziehungsweise mit D1 Time Travel.

## 0035 – Pseudonyme Helferkonten und Sitzungen

Führt globale, nicht personenbezogene Helferkonten mit rollenkennzeichnendem Anmeldecode sowie
widerrufbare, gerätebezogene Browser-Sitzungen ein. PINs und Sitzungstoken werden ausschließlich als
gesalzene beziehungsweise kryptografische Hashes gespeichert. Bestehende Gerätebindungen bleiben
für die kontrollierte Migration erhalten. Vor Anwendung ist eine portable D1-Sicherung erforderlich;
ein Rollback erfolgt per D1 Time Travel oder Wiederherstellung dieser Sicherung.

## 0036 – Zugesagte Produkt-Flugzeit

Ergänzt Produkte additiv um die öffentlich kommunizierte Flugzeit in Minuten. Sie bleibt bewusst von
der prognostischen Referenzdauer getrennt und besitzt keine flugbetriebliche Freigabewirkung.
Bestehende Produkte übernehmen als sicheren Migrationsstart ihre bisherige Referenzdauer; neue
Produkte erhalten ohne abweichende Eingabe 20 Minuten. Vor Anwendung ist eine portable D1-Sicherung
erforderlich; ein Rollback erfolgt per D1 Time Travel oder Wiederherstellung dieser Sicherung, da D1
die additive Spalte nicht einzeln zurückbauen kann.

## 0037 – Cursorbasierte Kassenliste

Ergänzt ausschließlich einen Index über Veranstaltung, Verkaufszeit und technische ID. Vor
Anwendung wird eine portable D1-Sicherung erzeugt. Ein Rollback kann den Index
`idx_ticket_groups_cashier_list` gefahrlos entfernen; operative Daten und Auditereignisse werden
dabei nicht verändert.

## 0038 – Zeitpunkt des Flugzeug-Zustandswechsels

Ergänzt Flugzeuge additiv um `operational_state_changed_at` und befüllt Altbestände aus dem jüngsten
zuordenbaren Status- oder Umlaufereignis, ersatzweise aus dem jüngsten Ist-Umlaufzeitpunkt oder
`aircraft.updated_at`. Reine Stammdaten- und Tankplanänderungen verändern den Wert nicht. Vor
Anwendung wird eine portable D1-/R2-Sicherung erzeugt. Wiederherstellung erfolgt per D1 Time Travel
oder aus dieser Sicherung, weil D1 die additive Spalte nicht ohne Tabellenneuaufbau entfernt.

## 0039 – Loginbasierte Flight-Line-Betreuung

Ersetzt die kurzlebige gerätegebundene Assist-Reservierung durch eine 30 Minuten gültige,
versionierte Reservierung des pseudonymen Operator-Kontos. Bestehende Claims werden wegen ihrer
rein ephemeren Natur bewusst verworfen. Pro Veranstaltung kann ein Operator genau ein Flugzeug und
ein Flugzeug genau einen Operator beanspruchen. Fremdübernahmen werden nur mit der erwarteten
Claim-Revision ausgeführt und auditiert. Vor Anwendung ist eine portable D1-Sicherung erforderlich;
ein Rollback erfolgt per D1 Time Travel oder aus dieser Sicherung.

## 0040 – Ressourcengruppen-Kurzzeichen

Ergänzt Ressourcengruppen um ein veranstaltungsweit eindeutiges, stabiles Kurzzeichen. Bestände
werden deterministisch als `RG001`, `RG002` und fortlaufend je Veranstaltung befüllt; anschließend
sichert ein eindeutiger Index die Zuordnung. Vor Anwendung ist eine portable D1-Sicherung
erforderlich. Ein Rollback erfolgt per D1 Time Travel oder Wiederherstellung dieser Sicherung.

## 0042 – Öffentlicher Gruppencode und gruppenbezogenes Web-Push

Ergänzt jede öffentliche Buchungsgruppe um einen gehashten, geschützt gespeicherten Statuscode.
Bestandsgruppen übernehmen deterministisch den ältesten vorhandenen Ticketcode, sodass bestehende
Links unverändert funktionieren. Push-Abonnements werden zusätzlich der Buchungsgruppe zugeordnet
und reagieren damit auf jeden aktuellen Teilflug. Vor Anwendung ist eine D1-Time-Travel-Marke oder
vollständige D1-Sicherung verpflichtend. Die Wiederherstellung erfolgt per D1 Time Travel oder aus
dieser Sicherung, weil D1 die additiven Spalten nicht ohne Tabellenneuaufbau entfernen kann.

## 0043 – Kanonischer Zieltyp für Web-Push

Ergänzt Web-Push-Abonnements um `target_kind` (`TICKET` oder `GROUP`). Bestehende Ziele werden auf
den seit V1.8 kanonischen Gruppenstatus zurückgeführt; neue Einwilligungen speichern ihren
tatsächlichen Typ. Der Versand leitet daraus serverseitig ausschließlich relative öffentliche
Statuspfade ab. Vor Anwendung wird eine D1-Time-Travel-Marke oder vollständige D1-Sicherung
angelegt. Ein Rollback erfolgt per D1 Time Travel oder aus dieser Sicherung. Push-Abonnements
bleiben aus portablen R2-Backups ausgeschlossen und werden im Wiederherstellungsfall neu erteilt.

## 0044 – Themevarianten für Veranstaltungslogos

Ergänzt Veranstaltungen additiv um R2-Schlüssel und Medientyp des Logos für das dunkle Theme.
Die vorhandenen Logo-Spalten bleiben unverändert die helle Variante; Bestandslogos sind dadurch
ohne Datenkopie weiter verfügbar. Vor Anwendung wird eine D1-Time-Travel-Marke beziehungsweise
vollständige D1-/R2-Sicherung angelegt. Ein Rollback erfolgt per D1 Time Travel oder aus dieser
Sicherung, weil D1 die additiven Spalten nicht ohne Tabellenneuaufbau entfernt. Ein älterer Worker
kann die neuen nullable Spalten ignorieren, liefert dann aber ausschließlich die helle Variante.

## 0045 – Reset-Fortsetzungsfreigabe

Ergänzt Reset-Belege um Hash, Ablauf und Verbrauchszeit einer kurzlebigen Setup-Freigabe. Der
Klartextgrant wird nicht gespeichert. Vor Anwendung wird eine D1-Time-Travel-Marke beziehungsweise
portable Sicherung angelegt. Ältere Worker ignorieren die nullable Spalten; Wiederherstellung
erfolgt per Time Travel oder aus der Sicherung.

## 0046 – Weicher Betriebsplan und Betriebsbeginn

Ergänzt den optionalen geplanten Betriebsbeginn sowie weiche, versionierte Einschränkungen für
Veranstaltung, Ressourcengruppe, Flugzeug und anonymen Pilotencode. Ein Plan startet oder beendet
keinen operativen Zustand automatisch; erst ein menschlich bestätigtes Bestandskommando verknüpft
ihn mit einer tatsächlichen Blockierung. Vor Anwendung wird eine D1-Time-Travel-Marke
beziehungsweise portable Sicherung angelegt. Ein älterer Worker ignoriert die additiven Daten;
Wiederherstellung erfolgt per Time Travel oder aus der Sicherung.

## 0047 – Konten aus der aktiven Verwaltung entfernen

Ergänzt eine Löschmarkierung für pseudonyme Konten. Gelöschte Konten werden deaktiviert, aus
Anmeldung und Administration ausgeblendet und ihre Sitzungen durch eine neue Sitzungsrevision
ungültig. ID und Kontokennung bleiben intern reserviert, damit historische Audit-Zuordnungen
eindeutig bleiben. Vor Anwendung wird eine D1-Time-Travel-Marke beziehungsweise vollständige
D1-Sicherung angelegt. Ein älterer Worker ignoriert die nullable Spalte; Wiederherstellung erfolgt
per Time Travel oder aus der Sicherung.

## 0048 – Idempotente Veranstaltungslöschung

Ergänzt globale, technische Löschbelege, damit ein bestätigter Löschbefehl nach einer unterbrochenen
Antwort sicher wiederholt und eine noch offene R2-Logo-Bereinigung fortgesetzt werden kann. Die
Belege enthalten keine Klartext-Anmeldedaten und gehören bewusst nicht zum veranstaltungsbezogenen
portablen Backup. Vor Anwendung wird eine D1-Time-Travel-Marke beziehungsweise vollständige
D1-/R2-Sicherung angelegt. Ein älterer Worker ignoriert die zusätzliche Tabelle; eine vollständige
Wiederherstellung erfolgt per Time Travel oder aus der Sicherung.

## 0049 – Verzögerungswirkung im Betriebsplan

Ergänzt Betriebsplaneinträge additiv um die Wirkung `BLOCKING` oder `SLOWDOWN` und bei Verzögerungen
um einen Faktor von 110 bis 300 Prozent. Bestände bleiben durch den Standard `BLOCKING` unverändert.
Trigger verhindern unvollständige oder widersprüchliche Kombinationen. Vor Anwendung wird eine
D1-Time-Travel-Marke beziehungsweise portable Sicherung angelegt. Ein älterer Worker liest die
additiven Spalten nicht; für eine vollständige Schema-Rückkehr wird D1 per Time Travel oder aus der
Sicherung wiederhergestellt.

## 0050 – Wiederkehrende Betriebsregeln

Ergänzt veranstaltungsbezogene, versionierte Regeln für Pausen und Tanken nach bestätigten Umläufen
oder bestätigten Betriebsminuten. Automatisch erzeugte Vorkommen bleiben weiche Planeinträge und
sind über Regel und Sequenz eindeutig nachvollziehbar; sie ändern keinen operativen Zustand ohne
menschliches Bestätigungskommando. Ein partieller Index erlaubt je Ziel und Art höchstens eine
aktive Regel. Vor Anwendung wird eine D1-Time-Travel-Marke beziehungsweise portable Sicherung
angelegt. Für eine vollständige Schema-Rückkehr wird D1 per Time Travel oder aus dieser Sicherung
wiederhergestellt.

## 0052 – Erklärbare kapazitätsgetriebene Voraufrufe

Ergänzt Fluggruppen additiv um den letzten automatisch berechneten Voraufrufstatus, den fachlichen
Entscheidungsgrund, den Entscheidungszeitpunkt sowie den verwendeten Prognose- und Vorlaufwert.
Die Felder enthalten keine Gastdaten und ändern die stabile Kommunikationskennung nicht. Vor
Anwendung wird eine D1-Time-Travel-Marke beziehungsweise portable Sicherung angelegt. Ein älterer
Worker ignoriert die nullable Spalten; für eine vollständige Schema-Rückkehr wird D1 per Time
Travel oder aus dieser Sicherung wiederhergestellt.

## 0053 – Getrennte öffentliche Push-Übergänge

Erweitert den zulässigen Zustelltypkatalog um `GO_TO_GATE` und `BOARDING_STARTED`, damit
automatischer Voraufruf und menschlich bestätigter Boardingbeginn getrennte, idempotente
Mitteilungen erzeugen. Die Zustelltabelle wird unter Erhalt aller Belege neu aufgebaut; historische
`FLIGHT_GROUP_CALLED`-Zeilen bleiben unverändert gültig. Vor Anwendung wird eine
D1-Time-Travel-Marke beziehungsweise vollständige D1-Sicherung angelegt. Für eine vollständige
Schema-Rückkehr wird D1 per Time Travel oder aus dieser Sicherung wiederhergestellt; Push-Ziele
bleiben weiterhin aus portablen R2-Sicherungen ausgeschlossen.

## Historische Doppelnummer 0036

`0036_product_promised_flight_time.sql` und `0036_v1_5_stable_operations.sql` wurden bereits unter
ihren vollständigen Dateinamen angewendet. Sie werden nicht nachträglich umbenannt. Das automatisch
geprüfte Register erlaubt ausschließlich diese bekannte Doppelnummer und weist jede weitere
Nummerkollision ab.
