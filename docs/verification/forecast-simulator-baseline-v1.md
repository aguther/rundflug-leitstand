# Verifikation Prognose-Simulator V1

Stand: 26. Juli 2026

## Zweck und Ausführung

Der lokale Simulator wird mit `npm run simulator` ausschließlich auf `127.0.0.1` gestartet. Er
verwendet dieselbe reine Funktion `calculateForecastTimelines` aus `packages/domain` wie der Event
Coordinator. D1-Abfragen, Snapshot-Persistenz, Realtime, Authentifizierung, Service Worker und
Cloudflare-Ressourcen sind in diesem lokalen Simulatormodus nicht beteiligt.

Der normale Cloudflare-Build enthält denselben Simulator zusätzlich als lazy Route `/simulation`.
Der Einstieg liegt ausschließlich unter **Administration → Auswertung**, öffnet einen neuen Tab und
wird über die vorhandene Sitzung auf die Rolle `ADMIN` begrenzt. Die bestehende Sitzungs- und
Veranstaltungsauswahl darf beim Einstieg D1 lesen; die Simulation selbst verwendet weiterhin
ausschließlich synthetische Eingaben im Browser. CSV-Inhalte, Konfiguration und Ergebnisse werden
nicht an die API übertragen und nicht persistiert. Simulator-Chunks und -Styles sind vom
PWA-Precache ausgeschlossen.

Alle hier genannten Läufe verwenden die freigegebenen Standardparameter und Seed `20260722`.
Der Verkauf läuft 09:00–17:00 Uhr, der Flugbetrieb 10:00–18:00 Uhr Europe/Berlin. Das
Normalprofil verwendet zwei Wellen mit 40/8/32/6 Personen pro Stunde über
90/180/90/120 Minuten und damit einen Erwartungswert von 144 Personen. Die Nachfrage erzeugt
synthetische, ungeteilte Vierergruppen und wird mit der vorhandenen Queue-Planung disponiert. Die
Preset-Baseline ist als exakter Testwert fixiert.

## Baseline-Ergebnis

| Preset | erzeugte / abgeschlossene Umläufe | Boarding-Fenster getroffen | Median absolut | P90 absolut | Ø Fensterbreite | max. Reaktion |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Normalbetrieb | 40 / 28 | 0 % | 0,5 Min. | 23,1 Min. | 0 Min. | 29,648 Sek. |
| Stoßlast | 78 / 28 | 0 % | 0,5 Min. | 23,1 Min. | 0 Min. | 29,648 Sek. |
| Flugzeugausfall | 40 / 21 | 0 % | 0,5 Min. | 15,5 Min. | 0 Min. | 29,648 Sek. |
| Betriebsunterbrechung | 40 / 27 | 0 % | 0,5 Min. | 27,5 Min. | 0 Min. | 29,648 Sek. |

Die Baseline zeigt damit transparent, dass die aktuelle Prognoseformel für die meisten
Boarding-Prognosen Punktfenster statt praktisch nutzbarer Zeitspannen erzeugt. Die niedrige
Trefferquote ist kein Zielwert und wird nicht beschönigt: Der Simulator erfüllt gerade den Zweck,
diesen fehlenden operativen Mehrwert messbar zu machen. Die Korrektur der Freshness-Semantik macht
mehr Rohprognosen sichtbar, verbessert aber nicht automatisch deren Genauigkeit: Das Boarding-P90
steigt in allen vier Presets und bleibt ausdrücklich ein diagnostischer Befund.

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
| Normalbetrieb | 28 / 28 | 100 % | 18,0 Min. | 34,75 Min. | 5 | 0 |
| Stoßlast | 28 / 28 | 100 % | 18,0 Min. | 34,75 Min. | 5 | 0 |
| Flugzeugausfall | 21 / 21 | 100 % | 17,0 Min. | 29,5 Min. | 4 | 0 |
| Betriebsunterbrechung | 27 / 27 | 100 % | 17,0 Min. | 34,2 Min. | 8 | 0 |

Nicht jeder bis zum Simulationsende aufgerufene Umlauf besitzt einen Voraufruf: Ein bestätigter
Boardingbeginn bleibt fachlich auch ohne vorherigen Voraufruf möglich, beispielsweise wenn mehrere
Flugzeuge im selben Tick frei werden oder der gemeinsame Gate-Cooldown noch läuft. Die Kennzahl ist
daher diagnostisch und kein Freigabekriterium.

## Admin-Planwerte und A/B-Labor

Die aktuelle Baseline trennt erstmals die tatsächlich verwendeten Admin-Planwerte
`8/20/5/3` Minuten für Boarding, Produkt-Referenzdauer, Ausstieg und Puffer von den realen
Dreiecksverteilungen. Änderungen der Realität verändern nicht mehr gleichzeitig die
Prognosegrundlage. Aktive Prognosekapazität ist das Minimum aus verfügbaren Flugzeugen und aktiven
Piloten.

Der Standardvergleich verwendet 25 aufeinanderfolgende Seeds ab `20260722`. Sind Kandidat und
Produktionsprofil identisch, liefern sämtliche Vergleichskennzahlen exakt Delta `0`. Die
seedübergreifenden Mediane der wichtigsten Baselinewerte lauten:

| Kennzahl | Baseline |
| --- | ---: |
| Boarding Median absolut | 0,5 Min. |
| Boarding P90 absolut | 19,7 Min. |
| Boarding Bias | +4,75 Min. |
| Boarding Fensterbreite | 0 Min. |
| P90 bei 60 / 30 / 15 Minuten Horizont | 60,0 / 30,0 / 20,6 Min. |
| Off-Block / On-Block / Abschluss P90 | 2,3 / 6,98 / 0,45 Min. |
| Countdowns bei `UNCERTAIN` | 0 |
| GO TO GATE → Boarding Median / P90 | 16,5 / 34,65 Min. |

Der Vergleich läuft abbrechbar in einem lokalen Browser-Worker. Er bewertet keine Variante
automatisch als Gewinner.

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

- Ausreißer oberhalb `1,75×` Referenzdauer werden weiterhin unverändert verworfen. Die
  Freshness-Korrektur ändert weder diese Grenze noch Median-/MAD-Filter oder Gewichtung.
- Der Simulator bildet einen unmittelbar reagierenden idealisierten Bedienablauf ab. Er trifft keine
  flugbetriebliche, technische, sicherheitsrelevante oder luftrechtliche Entscheidung.
- Der CSV-Import kalibriert ausschließlich die Zeitverteilungen. Ohne Queue- und Snapshot-Historie
  rekonstruiert er keinen historischen Veranstaltungstag.
- Synthetische Gruppen füllen derzeit jeweils die konfigurierte Sitzplatzzahl eines einheitlichen
  Flugzeugtyps. Der Gruppenschutz und die Queue-Planung werden dadurch geprüft; mehrere Produkte
  oder Ressourcengruppen werden noch nicht modelliert.
- Exportiert werden nur Szenario, Seed, synthetisches Ereignisledger, Flugzeuge, Umläufe,
  Prognosesnapshots und Kennzahlen. Ticketcodes, Namen, Telefonnummern, PINs und Secrets sind weder
  Teil des Modells noch des Exports. Das Format trägt die Kennung
  `rundflug-forecast-simulation/v5`.

## Simuliertes Live-FIDS

Die Hauptansicht öffnet über `FIDS öffnen` genau ein separates, fokussierbares Browserfenster. Das
Fenster wird als React-Portal direkt aus dem lokalen Simulatorzustand gerendert und besitzt keine
eigene Route, Authentifizierung, API-Abfrage, WebSocket-Verbindung, Browser-Persistenz oder
Service-Worker-Registrierung. Ein blockiertes Pop-up wird in der Hauptansicht verständlich gemeldet.

Die Projektion verwendet den bestehenden `PublicBoard`-Vertrag ausschließlich im Speicher. Sie
berücksichtigt nur Gruppen, Meilensteine und den letzten Prognosesnapshot bis zum sichtbaren
30-Sekunden-Tick. DRAFT-Gruppen erscheinen als `WARTEN` oder nach Voraufruf als `GO TO GATE`,
aufgerufene Gruppen als `BOARDING`; Abflug, Landung und Abschluss werden im FIDS einheitlich als
`ABGEFLOGEN` präsentiert. Bei Unterbrechung zeigt die Anzeige den bestehenden roten
Betriebshinweis, setzt die Prognosequalität auf `UNCERTAIN` und veröffentlicht kein numerisches
Zeitfenster.

Die Anzeige verwendet ausschließlich synthetische `G-SIM-####`-Kennungen, `Rundflug Simulation`
und `Flight Line 1`. Sie besitzt 20 Zeilen, einspaltiges Layout und keine Einstellungen.
`LIVE-SIMULATION`, `Virtuelle Zeit` und der permanente Hinweis
`Nur Simulation – keine Betriebsdaten` verhindern eine Verwechslung mit Betriebsdaten.
Abflugtransitionen bleiben auch bei 60× oder 300× für 15 Sekunden realer Betrachtungszeit sichtbar;
Neustart, Rücksprung und ein neu berechnetes Ergebnis löschen diese Anzeigehistorie.

## Browserabnahme

Die in Release 1.10.0 konsolidierten Simulatorabläufe wurden im lokalen
Vite-Modus mit dem In-App-Browser gegen die gerenderte Anwendung verglichen. Die Funktionsprüfung
erfolgte bei 1280×720; ergänzende Headless-Aufnahmen belegen das Layout bei 1536×1024 und 1280×800.
Light und Dark Mode wurden jeweils im In-App-Browser geprüft:

- die ergänzende Nachfrageabnahme vom 26. Juli 2026 prüft das freigegebene Konzept
  die Nachfrageansicht nativ bei 1536×1024 und 1280×800, jeweils in
  Light und Dark Mode;
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
- das FIDS-Pop-out folgt Start, Pause, `+5 Min.`, Szenariowechsel und Betriebsunterbrechung, ohne die
  Bedienung des Simulatorfensters zu blockieren;
- ein zweiter Klick auf `FIDS öffnen` fokussiert das vorhandene Fenster und erzeugt kein Duplikat;
- das simulierte FIDS zeigt bei 1920 × 1080 und 1280 × 720 weder Dokument- noch Tabellen-Scrollbars
  und bleibt in heller wie dunkler Darstellung lesbar;
- eine vollständig neu geladene Browserseite enthält sinnvollen Anwendungsinhalt, kein
  Framework-Fehleroverlay und keine Konsolenfehler oder -warnungen;
- Netzwerkaufzeichnung nach Reload: ausschließlich lokale Vite-Modul- und HMR-Verbindungen,
  keine externe URL, kein `/api/`-Aufruf und kein Service-Worker-Modul.

Der normale Produktionsbuild enthält den Simulator als separaten Lazy-Chunk. Die Route ist nicht
Teil des allgemeinen Ansichtswechslers und wird erst nach erfolgreicher Anmeldung,
Veranstaltungsauswahl und Rollenprüfung gerendert. Nicht angemeldete Aufrufe zeigen die Anmeldung;
andere Rollen werden auf ihren jeweiligen Arbeitsbereich zurückgeführt. Die Simulator-Artefakte
werden nicht in den PWA-Precache aufgenommen und daher erst beim bewussten Admin-Aufruf geladen.
