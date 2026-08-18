# Verifikation Prognose-Simulator V1

Stand: 18. August 2026

## Zweck und Ausführung

Der lokale Simulator wird mit `npm run simulator` ausschließlich auf `127.0.0.1` gestartet. Er
verwendet dieselbe reine Funktion `calculateForecastTimelines` aus `packages/domain` wie der Event
Coordinator. D1-Abfragen, Snapshot-Persistenz, Realtime, Authentifizierung, Service Worker und
Cloudflare-Ressourcen sind in diesem lokalen Simulatormodus nicht beteiligt.

Der normale Cloudflare-Build enthält denselben Simulator zusätzlich als lazy Route `/simulation`.
Der Einstieg liegt ausschließlich unter **Administration → Auswertung**, öffnet einen neuen Tab und
wird über die vorhandene Sitzung auf die Rolle `ADMIN` begrenzt. Die bestehende Sitzungs- und
Veranstaltungsauswahl darf beim Einstieg D1 lesen. Zusätzlich kann ein Administrator eine
eigens dafür begrenzte Simulationsgrundlage herunterladen und anschließend lokal über die
Dateiauswahl importieren. Die Simulation selbst führt keine API-Abfrage aus. CSV-/JSON-Inhalte,
Szenariokonfiguration und Ergebnisse werden nicht an die API übertragen und weder im Browser
noch serverseitig persistiert. Simulator-Chunks und -Styles sind vom PWA-Precache ausgeschlossen.

Alle hier genannten Läufe verwenden die freigegebenen Standardparameter und Seed `20260722`.
Der Verkauf läuft 09:00–17:00 Uhr, der Flugbetrieb 10:00–18:00 Uhr Europe/Berlin. Das
Normalprofil verwendet zwei Wellen mit 40/8/32/6 Personen pro Stunde über
90/180/90/120 Minuten und damit einen Erwartungswert von 144 Personen. Die Nachfrage erzeugt
synthetische, ungeteilte Gruppen zwischen einer Person und der Referenzkapazität. Presets werden an
der Engine-Grenze auf ein Gate, eine Ressourcengruppe, ein Produkt sowie die konfigurierte Zahl
synthetischer Flugzeuge und Pilotencodes abgebildet. Dieselbe operative Engine verarbeitet auch
importierte Modelle. Die Preset-Baseline ist als exakter Testwert fixiert.

## Baseline-Ergebnis

| Preset | erzeugte / abgeschlossene Umläufe | letztes Boardingfenster getroffen | Erstprognose Median absolut | Median absolut letzter Snapshot | P90 absolut letzter Snapshot | Ø Fensterbreite | max. Reaktion |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Normalbetrieb | 35 / 22 | 95,45 % | 35,25 Min. | 2,0 Min. | 2,5 Min. | 4,45 Min. | 0 Sek. |
| Stoßlast | 88 / 22 | 100 % | 91,0 Min. | 2,0 Min. | 2,45 Min. | 4,50 Min. | 0 Sek. |
| Flugzeugausfall | 35 / 22 | 95,45 % | 35,25 Min. | 2,0 Min. | 2,5 Min. | 4,45 Min. | 0 Sek. |
| Betriebsunterbrechung | 34 / 22 | 86,36 % | 38,25 Min. | 2,0 Min. | 16,0 Min. | 4,59 Min. | 0 Sek. |

Diese Werte sind bewusst eine neue Vergleichsbasis: Die früheren Presets liefen durch eine separate
Legacy-Engine und sind nicht unmittelbar vergleichbar. Fensterbreite und Trefferquote entstehen nun
aus derselben Dauerbasis und Schedulerprojektion wie im operativen Modell. Die Unterbrechungsbaseline
zeigt weiterhin sichtbar die größere Unsicherheit außergewöhnlicher Betriebsphasen.

Die Fensterabdeckung und die bisherigen Boardingfehler verwenden je aufgerufener Fluggruppe den
letzten verfügbaren DRAFT-Snapshot vor dem tatsächlichen Boarding. Die Erstprognose-Kennzahl verwendet
dagegen genau den frühesten verfügbaren DRAFT-Snapshot und verwirft Snapshots ohne veröffentlichbare
Prognose. Ihr Tageswert ist der Median der absoluten Abweichungen; im Gruppenverlauf bleibt das
Vorzeichen sichtbar, wobei positive Werte eine gegenüber dem Ist spätere Prognose bedeuten.

Alle vier Presets weisen `0` dargestellte Countdowns während `UNCERTAIN` aus. Ereignisbedingte
Neuberechnungen erfolgen im 30-Sekunden-Raster und liegen mit maximal 29,648 Sekunden innerhalb des
harten Prüfkriteriums.

## Automatischer Voraufruf

Der Simulator verwendet für `GO TO GATE` dieselben reinen Domain-Funktionen
`deriveAdaptivePrecallLeadMinutes` und `selectAutomaticPrecalls` wie der Worker. Alle queue-stabilen
Gruppen innerhalb des gemeinsamen Prognosefensters können im selben 30-Sekunden-Tick voraufgerufen
werden; ein vorhandener Voraufruf blockiert Nachfolger nicht. Jeder Voraufruf wird vor der
Flugzeugbindung mit Trigger, Prognosequalität, prognostiziertem Boarding und adaptivem Vorlauf
protokolliert. Prognoseunsicherheit ist entsprechend ADR-0012 keine harte Auslösesperre; operative
Sperrgründe, ein ungeeigneter vorderer Queue-Eintrag und fehlende passende Kapazität bleiben es.

| Preset | voraufgerufen / aufgerufen | Abdeckung | Median Gate → Boarding | P90 | gleicher 30-Sek.-Tick | bei `UNCERTAIN` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Normalbetrieb | 22 / 22 | 100 % | 23,5 Min. | 40,0 Min. | 3 | 0 |
| Stoßlast | 22 / 22 | 100 % | 22,5 Min. | 40,45 Min. | 3 | 0 |
| Flugzeugausfall | 22 / 22 | 100 % | 23,5 Min. | 40,0 Min. | 3 | 0 |
| Betriebsunterbrechung | 22 / 22 | 100 % | 18,0 Min. | 63,45 Min. | 3 | 0 |

Nicht jeder bis zum Simulationsende aufgerufene Umlauf besitzt einen Voraufruf: Ein bestätigter
Boardingbeginn bleibt fachlich auch ohne vorherigen Voraufruf möglich, beispielsweise wenn mehrere
Flugzeuge im selben Tick frei werden oder der gemeinsame Gate-Cooldown noch läuft. Die Kennzahl ist
daher diagnostisch und kein Freigabekriterium.

## Admin-Planwerte und A/B-Labor

Die aktuelle Baseline trennt erstmals die tatsächlich verwendeten Admin-Planwerte
`8/20/5/3` Minuten für Boarding, Produkt-Referenzzeit Offblock–Onblock, Ausstieg und Puffer von den realen
Dreiecksverteilungen. Änderungen der Realität verändern nicht mehr gleichzeitig die
Prognosegrundlage. Aktive Prognosekapazität ist das Minimum aus verfügbaren Flugzeugen und aktiven
Piloten.

Der Standardvergleich verwendet 25 aufeinanderfolgende Seeds ab `20260722`. Sind Kandidat und
Produktionsprofil identisch, liefern sämtliche Vergleichskennzahlen exakt Delta `0`. Die
seedübergreifenden Mediane der wichtigsten Baselinewerte lauten:

| Kennzahl | Baseline |
| --- | ---: |
| Boarding Erstprognose Median absolut | 128,0 Min. |
| Boarding Median absolut | 1,0 Min. |
| Boarding P90 absolut | 2,0 Min. |
| Boarding Bias | +1,3 Min. |
| Boarding Fensterbreite | 3,59 Min. |
| P90 bei 60 / 30 / 15 Minuten Horizont | 58,5 / 28,5 / 13,5 Min. |
| Off-Block / On-Block / Abschluss P90 | 3,06 / 4,98 / 0,5 Min. |
| Countdowns bei `UNCERTAIN` | 0 |
| GO TO GATE → Boarding Median / P90 | 100,75 / 203,0 Min. |

Der Vergleich läuft abbrechbar in einem lokalen Browser-Worker. Er bewertet keine Variante
automatisch als Gewinner.

## Operative Simulationsgrundlage und Szenario

Unter **Administration → Auswertung** erzeugt
`GET /api/control/:eventId/exports/simulation-plan.json` das strikt validierte Format
`rundflug-simulation-plan` Version 2. Version 1 bleibt importkompatibel. Der lesende Export ist für `ADMIN` und
`FLIGHT_DIRECTOR` autorisiert; die aktuelle Oberfläche bietet ihn ausschließlich in der
Administration an. Enthalten sind:

- Veranstaltungszeiten und fachliche Planparameter,
- Gates, Ressourcengruppen, aktuell zugeordnete Flugzeuge, anonyme Pilotencodes und Produkte,
- ausschließlich noch offene Planeinträge im Zustand `PLANNED`.

Nicht enthalten sind Tickets oder Ticketcodes, Buchungs- und Fluggruppen, Queues, aktuelle
Flugzeug-/Piloten-/Umlaufzustände, Prognosesnapshots, Ereignisledger, Auditdaten,
Operatorenkonten oder Sitzungen. Ein operativer Bezug auf einen aktuellen Umlauf wird nicht
exportiert. Stattdessen trägt der Eintrag nur `afterCurrentRotation: true` und bleibt nach dem
Import ausdrücklich unaufgelöst.

Der gemeinsame Dialog **Importieren** bündelt eingebaute Szenarien, Simulationsdateien und
CSV-Kalibrierung. Die JSON-Quelle akzeptiert das operative Format V1/V2, das bestehende
`rundflug-master-data-template` Version 1 und das browserlokale
`rundflug-simulation-scenario` Version 1 und 2. Version 1 bleibt als begrenzte Vorlage mit Preset-,
Zeit-, Nachfrage-, Phasen-, Ereignis- und Prognoseparametern importkompatibel. Version 2 sichert
zusätzlich das vollständige konfigurierbare Szenario: operative Topologie, produktbezogene
Nachfrage, Planeinträge und wiederkehrende Regeln. Tickets, Queues, Ist-Zustände, Ergebnisse,
manuelle Laufereignisse und die Abspielposition sind weiterhin nicht enthalten.

Das im Dialog gewählte eingebaute Szenario kann als JSON-Vorlage heruntergeladen werden. Zusätzlich
exportiert **Szenario exportieren** die aktuelle Konfiguration als strikt validierte
V2-Szenariodatei. Ein bestätigter Szenario- oder JSON-Import ersetzt die aktuelle Konfiguration und
setzt manuelle Ereignisse, Abspielposition und laufende Wiedergabe zurück. Die CSV-Quelle kalibriert
ausschließlich die Realitätsphasen des aktuellen Szenarios und behält dessen Quellnamen. Export,
Vorschau und Import bleiben vollständig browserlokal und führen keine API-Abfrage aus.

JSON-Dateien sind auf 1 MiB, CSV-Kalibrierungen auf 2 MiB begrenzt. Die JSON-Inhalte werden vor der
Übernahme vollständig gegen ihr striktes Vertragsschema geprüft. Die Vorschau nennt Quelle und die
jeweils relevanten Parameter oder Anzahlen.
Umlaufgebundene Einträge blockieren den Start, bis sie im Tagesplan in ein Zeitfenster umgewandelt
oder in der Importvorschau bewusst ausgeschlossen werden. Das Stammdaten-Template behält mangels
Tagesplan die bisher im Simulator eingestellten Zeiten und enthält keine Planeinträge.

Die Simulatorseite hält genau ein aktuelles Szenario ausschließlich im React-Zustand. Die Oberfläche
zeigt dessen automatisch abgeleiteten Quellnamen und den Hinweis **Nicht gespeichert**; eine
Benennung, Duplizierung oder Auswahl mehrerer Varianten wird nicht angeboten. Ein Reload verwirft die
Konfiguration weiterhin bewusst; eine benötigte Konfiguration wird vorher über den V2-Export
gesichert. Szenarioübersicht und Seed sind in der Sidebar rein lesend, Änderungen erfolgen
ausschließlich im modalen Konfigurationsdialog.

Diese UI-Bündelung ändert weder Systemgrenzen noch Persistenz, Importverträge, Engine-Datenfluss oder
den flüchtigen Kanal zum Simulations-FIDS und ist daher nicht architekturrelevant.

Für importierte Stammdaten erzeugt das aktuelle Szenario weiterhin ausschließlich synthetische Nachfrage,
Gruppen, Umläufe und Ist-Ereignisse. Die voreingestellte Gesamtnachfrage von 18 Personen pro
Stunde wird gleichmäßig über die importierten Produkte verteilt. Anschließend besitzt jedes Produkt
ein unabhängig konfigurierbares Tagesprofil mit eigener Vorlage, eigenen Zeitfenstern und
Personenraten. Die Werte einer Ressourcengruppe und des Gesamttags sind ausschließlich
schreibgeschützte Summen dieser Produktprofile. Eine Änderung des Verkaufszeitraums skaliert alle
Produktfenster, ohne deren Personenraten oder die Profile anderer Produkte zu koppeln. Die
Queue-Planung berücksichtigt Produkt, Ressourcengruppe, heterogene Flugzeugkapazitäten und
gemeinsam verfügbare anonyme Pilotencodes.

Der Tagesplan unterstützt dieselben Arten und Geltungsbereiche wie der operative Plan:
Pause, Tanken, Flugshow, Wetter, Technik oder Sonstiges für Veranstaltung,
Ressourcengruppe, Flugzeug oder Pilotencode. Ein Seed realisiert Beginn und Dauer reproduzierbar
innerhalb des angegebenen Zeit- beziehungsweise Dauerfensters. Diese Realisierung ist eine
synthetische Annahme und keine operative Bestätigung. Planstart und -ende erscheinen im lokalen
Ereignisledger, als Sperre in der Disposition, als Segment auf der Zeitachse und – bei neutralem
öffentlichem Hinweis auf Veranstaltungs- oder Gruppenebene – im simulierten FIDS.

Die Zeitachse trennt den schraffierten Tagesplan von realisierten Betriebsereignissen. Geplante
Pausen nach einem Umlauf, Tanken, ungeplante Pausen, technische Defekte und Tagesausfälle
erscheinen auf der jeweiligen Flugzeugspur; globale Unterbrechungen erscheinen auf der
gemeinsamen Betriebsspur. Eine noch offene Sperre endet in der Darstellung an der aktuell
sichtbaren Simulationszeit, sodass kein zukünftiges Rückkehrereignis vorweggenommen wird.

Der Editor **Simulierte Realität → Betriebsereignisse** trennt wiederkehrende Standards von
zufälligen Pausen und Defekten. Bei importierten Stammdaten erscheinen zielbezogene Tank- und
Pausenregeln im selben Abschnitt. Gemäß ADR-0028 ersetzt eine solche Regel nur für das gewählte
Flugzeug beziehungsweise den Pilotencode den entsprechenden Standard; bestätigter Fortschritt und
alle Prognosewirkungen bleiben erhalten. Der Tagesplan enthält dadurch keinen redundanten zweiten
Regeleditor mehr.

Beide Prognosediagramme sind ohne zusätzliche Diagrammbibliothek interaktiv. Beim Zeigen auf einen
Messpunkt nennt der Tagesfehlerverlauf Snapshotzeit, damalige Boarding-Prognose, Ist-Boarding und
Fehler. Die Gruppenauswertung zeigt für den gewählten Snapshot dessen Erfassungszeit sowie die
damals gültigen Prognosen für Boarding, Off-Block, On-Block und Abschluss. Die Messpunkte werden
vor dem Verbinden chronologisch sortiert.

## Korrektur der falschen Unterdrückung

Vor Betriebsbeginn ist die Ressourcengruppe absichtlich prognostisch inaktiv. In diesem Abschnitt
entstehende DRAFT-Snapshots dürfen deshalb `UNCERTAIN` sein und keine numerische Voraufruf- oder
Boardingfreigabe auslösen. Nach Betriebsbeginn erzeugt allein das Alter des letzten Lernwerts bei
positiver aktiver Kapazität weiterhin keine Unterdrückung; `STALE_PREDICTION` tritt im vollständig
lokal und alle 30 Sekunden neu berechneten Lauf nicht auf.

Die früher für gleichmäßige Nachfrage dokumentierten Snapshot-Anzahlen und
Vorher-/Nachher-Horizontwerte sind wegen der neuen Zwei-Wellen-Nachfrage und der zusätzlichen
Vorverkaufsstunde nicht mit der aktuellen Baseline vergleichbar. Maßgeblich sind daher die oben
festgeschriebenen Preset- und 25-Seed-Werte.

## Messmethode

- Für Boarding werden das letzte geeignete DRAFT-Snapshot vor dem Ist-Aufruf und dessen Zeitfenster
  bewertet.
- Für Start, Landung und Abschluss werden entsprechend die letzten Snapshots in `CALLED`,
  `IN_FLIGHT` und `LANDED` verwendet.
- Für 60, 30 und 15 Minuten Horizont geht je Umlauf höchstens das letzte DRAFT-Snapshot vor dem
  jeweiligen Grenzzeitpunkt ein. Häufige 30-Sekunden-Snapshots erhalten dadurch kein zusätzliches
  Gewicht.
- Bias ist `Prognose minus Ist`: positive Werte bedeuten systematische Überschätzung, negative Werte
  Unterschätzung.
- CSV-Kalibrierung verwendet nach Plausibilitäts- und MAD-Filter robuste P10/P50/P90-Werte. Mindestens
  fünf gültige, nicht unterbrochene abgeschlossene Umläufe sind erforderlich; der Puffer bleibt
  manuell.

## Bekannte Grenzen

- Ausreißer oberhalb `1,75×` Referenz-Umlaufzeit werden weiterhin unverändert verworfen. Die
  Freshness-Korrektur ändert weder diese Grenze noch Median-/MAD-Filter oder Gewichtung.
- Der Simulator bildet einen unmittelbar reagierenden idealisierten Bedienablauf ab. Er trifft keine
  flugbetriebliche, technische, sicherheitsrelevante oder luftrechtliche Entscheidung.
- Der CSV-Import kalibriert ausschließlich die Zeitverteilungen. Ohne Queue- und Snapshot-Historie
  rekonstruiert er keinen historischen Veranstaltungstag.
- Ohne importierte Simulationsgrundlage verwendet die freigegebene Baseline weiterhin genau ein
  synthetisches Produkt, eine Ressourcengruppe und einen einheitlichen Flugzeugtyp. Importierte
  Szenarien modellieren mehrere Produkte, Ressourcengruppen, Gates, Flugzeugtypen und
  Pilotencodes.
- Operative Planeinträge im Zustand `ACTIVE`, `CLEARED`, `CANCELED` oder der zeitabhängig
  abgeleiteten Fälligkeit werden nicht als Plan exportiert. Der Simulator rekonstruiert damit
  ausdrücklich keinen bereits begonnenen Veranstaltungstag.
- Ein importierter Tagesplan ist weder Dienstplan noch technische, flugbetriebliche,
  sicherheitsrelevante oder luftrechtliche Freigabe.
- Exportiert werden nur Szenario, Seed, synthetisches Ereignisledger, Flugzeuge, Umläufe,
  Prognosesnapshots und Kennzahlen. Ticketcodes, Namen, Telefonnummern, PINs und Secrets sind weder
  Teil des Modells noch des Exports. Das Format trägt die Kennung
  `rundflug-forecast-simulation/v7`.

## Simuliertes Live-FIDS

Die Hauptansicht verlinkt über `FIDS in neuem Tab öffnen` die eigenständige Route
`/simulation/fids`. Der FIDS-Tab verwendet einen eigenen React-Baum und dieselbe gemeinsame
FIDS-Experience wie der Livebetrieb. Er besitzt keine API-Abfrage, WebSocket-Verbindung,
Browser-Persistenz oder Service-Worker-Registrierung. Im lokalen Simulator-Modus ist die Route ohne
Anmeldung erreichbar; im gehosteten Build bleibt sie wie `/simulation` auf `ADMIN` beschränkt.

Ein versionierter gleichursprünglicher `BroadcastChannel` überträgt den vollständigen
Simulatorzustand nur beim Start, auf Anfrage und nach Ergebnisänderungen. Kleine Heartbeats führen
virtuelle Uhr, sichtbaren Tick, Geschwindigkeit und Laufstatus fort. Eine lokale Quellen-ID bindet
den FIDS-Tab eindeutig an seinen Simulator. Ein Direktaufruf ohne laufende Quelle zeigt einen
Wartezustand und verbindet sich automatisch; nach einem Abbruch bleibt der letzte In-Memory-Stand
mit `SIMULATION GETRENNT` sichtbar.

Die Projektion verwendet den bestehenden `PublicBoard`-Vertrag ausschließlich im Speicher. Sie
berücksichtigt nur Gruppen, Meilensteine und den letzten Prognosesnapshot bis zum sichtbaren
30-Sekunden-Tick. DRAFT-Gruppen erscheinen als `WARTEN` oder nach Voraufruf als `GO TO GATE`,
aufgerufene Gruppen als `BOARDING`; Abflug, Landung und Abschluss werden im FIDS einheitlich als
`ABGEFLOGEN` präsentiert. Bei Unterbrechung zeigt die Anzeige den bestehenden roten
Betriebshinweis, setzt die Prognosequalität auf `UNCERTAIN` und veröffentlicht kein numerisches
Zeitfenster.

Die Anzeige verwendet ausschließlich synthetische Gruppenkennungen. In der Baseline lauten
Produkt und Gate `Rundflug Simulation` und `Flight Line 1`; importierte Szenarien verwenden die
importierten Produktcodes, Produktnamen und Gatebezeichnungen. Sie zeigt 20 Einträge in zwei
Spalten mit jeweils zehn Zeilen und besitzt
weder Einstellungen noch die für den öffentlichen Betrieb bestimmte Fußzeile. `LIVE-SIMULATION`,
die virtuelle Uhrzeit und der permanente Hinweis `Nur Simulation – keine Betriebsdaten` verhindern
eine Verwechslung mit Betriebsdaten. Abflugtransitionen bleiben bei 1× für 15 Sekunden realer
Betrachtungszeit sichtbar. Die Dauer wird bei beschleunigter Wiedergabe durch die
Simulationsgeschwindigkeit geteilt und beträgt mindestens eine Sekunde; Neustart, Rücksprung und ein
neu berechnetes Ergebnis löschen diese Anzeigehistorie.

## Browserabnahme

Die in Release 1.10.0 konsolidierten Simulatorabläufe wurden im lokalen
Vite-Modus mit dem In-App-Browser gegen die gerenderte Anwendung verglichen. Die Funktionsprüfung
erfolgte bei 1280×720; ergänzende Headless-Aufnahmen belegen das Layout bei 1536×1024 und 1280×800.
Light und Dark Mode wurden jeweils im In-App-Browser geprüft:

- die ergänzende Erstprognoseabnahme vom 18. August 2026 prüft mit Headless Chromium die fünf
  Kennzahlenkarten bei 1600×1000 im Dark Mode und 1280×900 im Light Mode. Alle Karten und Werte
  bleiben innerhalb ihrer Gridspalten; der Gruppenverlauf zeigt ersten Snapshot, erste
  Boardingprognose, Boarding-Ist und signierte Abweichung ohne Überlauf oder Konsolenmeldung;
- die ergänzende Nachfrageabnahme vom 26. Juli 2026 prüft das freigegebene Konzept
  die Nachfrageansicht nativ bei 1536×1024 und 1280×800, jeweils in
  Light und Dark Mode;
- die ergänzende Produktnachfrageabnahme vom 29. Juli 2026 importiert drei synthetische Produkte in
  zwei Ressourcengruppen: Aus 18 Personen/Stunde entstehen zunächst die abgeleiteten
  Gruppenaggregate 12 und 6; die Änderung ausschließlich von `LB30` erhöht deren Werte auf 11 und
  den Gesamtwert auf 23 Personen/Stunde, während beide `KA`-Produkte unverändert bei jeweils 6
  bleiben;
- die Verlängerung des Verkaufsendes von 17:00 auf 18:00 skaliert die Endfenster aller drei
  Produktprofile auf 18:00 und erhält deren individuelle Personenraten;
- bei 1536×1024 und 1280×800 entsprechen Dokumentbreite und Viewport in Light und Dark exakt
  einander; das 759 Pixel breite Panel und der 711 Pixel breite Produktnachfragebereich besitzen
  jeweils identische Client- und Scrollbreiten und erzeugen keinen horizontalen Überlauf;
- Tageszeiten und alle Nachfragefenster werden unabhängig von der Browser-Locale eindeutig im
  24-Stunden-Format `HH:MM` dargestellt;
- der Vorlagenwechsel auf Morgenandrang erhält Ø 18 Personen/Stunde und 144 erwartete Personen;
  `Zeitfenster hinzufügen` teilt das längste Fenster und übernimmt dessen Rate;
- eine manuelle Fensteränderung setzt `Benutzerdefiniert`; eine erzeugte Überlappung zeigt
  `Nachfragefenster 1 und 2 überlappen sich.` und deaktiviert `Übernehmen & neu starten`;
- um 09:55 enthält die sichtbare Anfangsqueue zwölf Gruppen, ohne `GO TO GATE`, Boarding oder
  aktivierbare Störungstaste; um 10:00 beginnen genau drei Boardings und die operativen
  Störungstasten werden aktiv;
- um 18:00 bleiben die drei zu diesem Zeitpunkt laufenden Umläufe sichtbar, während keine neue
  Gruppe mehr aufgerufen wird und die Störungstasten deaktiviert sind; der Lauf endet nach deren
  Abschluss um 18:27;
- bei 1536×1024 entsprechen Dokument- und Clientbreite jeweils 1536 Pixel; bei 1280×800 jeweils
  1265 Pixel wegen der vertikalen Browser-Scrollbar. Der 536 Pixel breite Drawer besitzt in beiden
  Fällen identische Client- und Scrollbreite und erzeugt keinen horizontalen Überlauf;
- die Browserkonsole enthält nach Editor-, Validierungs-, Wiedergabe- und Theme-Prüfung keine
  Warnung und keinen Fehler;
- Normalbetrieb bei virtueller Zeit 11:40 mit einem mehr als fünf Minuten alten Lernwert zeigt die
  reguläre Boarding-Prognose und keine Unterdrückung;
- eine ausgewählte Fluggruppe während der Betriebsunterbrechung zeigt keinen Countdown, aber die
  klar bezeichnete Rohprognose und die Gründe „Betrieb unterbrochen“ sowie „Ressourcengruppe nicht
  aktiv“;
- die Detailansicht enthält Rohzeiten aller Phasen, Stichprobengröße, Lernwertalter, aktive
  Kapazität und Unterdrückungsgrund; die Auswertung enthält zusätzlich deren Verteilung;
- die Verlaufsauswertung zeigt für eine abgeschlossene Gruppe 149 einzelne Snapshots, darunter 69
  DRAFT-Snapshots, ohne sie auf die 60-/30-/15-Minuten-Messpunkte zu reduzieren;
- `GO TO GATE` erscheint als eigener systemseitiger Meilenstein vor der Flugzeugbindung; ein
  Wechsel von der Flugzeughistorie zur zugehörigen Gruppe erhält diese Trennung;
- die Flugzeugansicht zeigt gebundene Umläufe mit Boarding, Off-Block, On-Block und Abschluss sowie
  Tanken, geplante Pause und jeweils das bestätigte Rückkehrereignis;
- kein horizontaler Dokument- oder Arbeitsbereichsüberlauf in den geprüften Viewports;
- der eigenständige FIDS-Tab folgt Start, Pause, `+5 Min.`, Szenariowechsel und
  Betriebsunterbrechung, ohne die Bedienung oder den Lebenszyklus des Simulator-Tabs zu verändern;
- ein Direktaufruf von `/simulation/fids` wartet ohne eigenen Standardlauf und verbindet sich nach
  dem Öffnen von `/simulation` automatisch; mehrere FIDS-Tabs dürfen dieselbe Quelle beobachten;
- Reload, Navigation und Schließen eines FIDS-Tabs beenden oder pausieren die Simulation nicht;
- das simulierte FIDS zeigt bei 1920 × 1080 und 1280 × 720 seine bis zu 20 Einträge in zwei
  Zehn-Zeilen-Spalten, hält Gruppe, Gate, Status und Zeitfenster jeweils einzeilig, erzeugt weder
  Dokument- noch Tabellen-Scrollbars und bleibt in heller wie dunkler Darstellung lesbar;
- eine vollständig neu geladene Browserseite enthält sinnvollen Anwendungsinhalt, kein
  Framework-Fehleroverlay und keine Konsolenfehler oder -warnungen;
- Netzwerkaufzeichnung nach Reload: ausschließlich lokale Vite-Modul- und HMR-Verbindungen,
  keine externe URL, kein `/api/`-Aufruf und kein Service-Worker-Modul.

Der normale Produktionsbuild enthält den Simulator als separaten Lazy-Chunk. Die Route ist nicht
Teil des allgemeinen Ansichtswechslers und wird erst nach erfolgreicher Anmeldung,
Veranstaltungsauswahl und Rollenprüfung gerendert. Nicht angemeldete Aufrufe zeigen die Anmeldung;
andere Rollen werden auf ihren jeweiligen Arbeitsbereich zurückgeführt. Die Simulator-Artefakte
werden nicht in den PWA-Precache aufgenommen und daher erst beim bewussten Admin-Aufruf geladen.

## Dispatch-Verifikation nach ADR-0032

Produktion und Simulator verwenden `createDispatchPlan` aus `packages/domain`. Der Simulator
erzeugt bei importierten Produkten deterministisch Gruppen unterschiedlicher Größe, hält jede
Buchungsgruppe atomar und führt nur produktreine Batches aus. Forecast und tatsächliche
Simulationsausführung verwenden dieselbe begrenzte Zielordnung.

Die Detail- und A/B-Auswertung weist zusätzlich folgende Dispatch-Kennzahlen aus:

- Personen pro Stunde und Personen pro Flugzeugstunde;
- angebotene und belegte Sitze sowie Sitzplatzauslastung;
- P50, P90 und Maximum der personenbezogenen Wartezeit sowie Mittelwert je Produkt;
- projizierte Überholungen und maximale Überholzahl je Gruppe;
- Serviceanteil und maximales Service-Defizit je Produkt;
- unnötige Planänderungen, Rücknahmen von `PREPARE` und Neuplanungen nach `GO TO GATE`;
- weiterhin Prognosefehler, Fensterabdeckung und Gate-Wartezeit.

Ein kleines, deterministisches Referenzbeispiel dokumentiert den Unterschied zum früheren
Ein-Gruppen-je-Umlauf-Verhalten: Queuegrößen `1, 1, 3, 1`, ein Dreisitzer, ein Produkt, alle Gruppen
gleichzeitig anwesend. Das alte Modell bot in vier Umläufen 12 Sitze an und belegte 6 (50 %). Der
Dispatch-Plan bildet die Batches `1+1+1` und `3`, bietet 6 Sitze an, belegt 6 (100 %) und halbiert
die nötigen Umläufe bei unveränderter Gruppenatomarität. Die allgemeine Freigabe stützt sich nicht
allein auf dieses Beispiel, sondern auf die Szenarien A–K und den Mehrseed-A/B-Lauf.

Die Stabilitätsdiagnostik zählt einen Bahnwechsel nur, wenn die bisherige Bahn weiterhin im Plan
vorhanden ist. Das normale Fortschreiten einer Welle sowie Ressourcenverlust sind keine unnötige
Planänderung. Für `GO TO GATE` bleibt eine weiterhin passende Bahn hart geschützt; ein
Ressourcenverlust darf neu planen, aber keine Gruppe duplizieren oder teilen.
