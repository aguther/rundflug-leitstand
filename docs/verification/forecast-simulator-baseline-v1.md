# Verifikation lokaler Prognose-Simulator V1

Stand: 22. Juli 2026

## Zweck und Ausführung

Der Simulator wird mit `npm run simulator` ausschließlich auf `127.0.0.1` gestartet. Er verwendet
dieselbe reine Funktion `calculateForecastTimelines` aus `packages/domain` wie der Event
Coordinator. D1-Abfragen, Snapshot-Persistenz, Realtime, Authentifizierung, Service Worker und
Cloudflare-Ressourcen sind im Simulatormodus nicht beteiligt.

Alle hier genannten Läufe verwenden die freigegebenen Standardparameter und Seed `20260722` für
10:00–18:00 Uhr Europe/Berlin. Die Nachfrage erzeugt synthetische, ungeteilte Vierergruppen und wird
mit der vorhandenen Queue-Planung disponiert. Die Preset-Baseline ist als exakter Testwert fixiert.

## Baseline-Ergebnis

| Preset | erzeugte / abgeschlossene Umläufe | Boarding-Fenster getroffen | Median absolut | P90 absolut | Ø Fensterbreite | max. Reaktion |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Normalbetrieb | 32 / 25 | 0 % | 0,5 Min. | 28,3 Min. | 0 Min. | 29,648 Sek. |
| Stoßlast | 68 / 25 | 0 % | 0,5 Min. | 24,5 Min. | 0 Min. | 29,648 Sek. |
| Flugzeugausfall | 32 / 20 | 0 % | 1,0 Min. | 16,3 Min. | 0 Min. | 29,648 Sek. |
| Betriebsunterbrechung | 32 / 26 | 0 % | 0,5 Min. | 30,1 Min. | 0,4 Min. | 29,648 Sek. |

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
`deriveAdaptivePrecallLeadMinutes` und `decideAutomaticPrecall` wie der Worker. Jeder Voraufruf wird
vor der Flugzeugbindung mit Trigger, Prognosequalität, prognostiziertem Boarding und adaptivem
Vorlauf protokolliert. Prognoseunsicherheit ist entsprechend ADR-0012 keine harte Auslösesperre;
operative Sperrgründe und fehlende passende Kapazität bleiben es.

| Preset | voraufgerufen / aufgerufen | Abdeckung | Median Gate → Boarding | P90 | gleicher 30-Sek.-Tick | bei `UNCERTAIN` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Normalbetrieb | 26 / 28 | 92,86 % | 9,5 Min. | 29,0 Min. | 6 | 0 |
| Stoßlast | 26 / 28 | 92,86 % | 12,25 Min. | 29,0 Min. | 5 | 0 |
| Flugzeugausfall | 20 / 21 | 95,24 % | 9,5 Min. | 26,35 Min. | 4 | 0 |
| Betriebsunterbrechung | 26 / 28 | 92,86 % | 8,25 Min. | 26,0 Min. | 7 | 0 |

Nicht jeder bis zum Simulationsende aufgerufene Umlauf besitzt einen Voraufruf: Ein bestätigter
Boardingbeginn bleibt fachlich auch ohne vorherigen Voraufruf möglich, beispielsweise wenn mehrere
Flugzeuge im selben Tick frei werden oder der gemeinsame Gate-Cooldown noch läuft. Die Kennzahl ist
daher diagnostisch und kein Freigabekriterium.

## Korrektur der falschen Unterdrückung

Vor der Korrektur waren im Normalbetrieb 1.108 von 1.507 für tatsächlich aufgerufene Umläufe
auswertbaren DRAFT-Snapshots `UNCERTAIN`. 1.050 davon wurden ausschließlich unterdrückt, weil der
letzte abgeschlossene Lernumlauf mehr als fünf Minuten zurücklag. Ihr Medianfehler betrug trotzdem
nur acht Minuten; P90 lag bei 25,5 Minuten.

Nach der Korrektur enthält der vollständige Normalbetrieb 3.106 stabile, 713 veränderliche und 58
unsichere Snapshots. Sämtliche 58 Unsicherheiten beruhen auf tatsächlich fehlender aktiver
Kapazität; `STALE_PREDICTION` tritt im vollständig lokal und alle 30 Sekunden neu berechneten Lauf
nicht auf. Lernwertalter über fünf Minuten erzeugt bei positiver Kapazität keine Unterdrückung mehr.

Die festen Boarding-Horizonte zeigen folgenden Vorher-/Nachher-Vergleich; angegeben sind
Median/P90 des absoluten Fehlers in Minuten:

| Preset | Horizont | vorher | nachher |
| --- | ---: | ---: | ---: |
| Normalbetrieb | 15 Min. | 7,0 / 36,0 | 7,0 / 40,0 |
| Normalbetrieb | 30 Min. | 14,0 / 25,0 | 10,0 / 25,0 |
| Normalbetrieb | 60 Min. | 29,5 / 29,9 | 22,5 / 22,9 |
| Stoßlast | 15 Min. | 8,0 / 30,4 | 8,0 / 30,4 |
| Stoßlast | 30 Min. | 8,5 / 27,5 | 8,0 / 27,5 |
| Stoßlast | 60 Min. | 23,0 / 35,4 | 20,0 / 33,6 |
| Flugzeugausfall | 15 Min. | 8,5 / 22,0 | 8,5 / 25,5 |
| Flugzeugausfall | 30 Min. | 9,0 / 20,0 | 10,0 / 21,0 |
| Flugzeugausfall | 60 Min. | 28,0 / 50,4 | 25,0 / 54,4 |
| Betriebsunterbrechung | 15 Min. | 10,0 / 21,8 | 10,0 / 26,6 |
| Betriebsunterbrechung | 30 Min. | 14,0 / 28,4 | 11,0 / 28,4 |
| Betriebsunterbrechung | 60 Min. | 7,0 / 21,4 | 22,0 / 27,6 |

Die kleinen Stichproben bei langen Horizonten, insbesondere im Unterbrechungspreset, erlauben
keine belastbare Aussage über eine generelle Verbesserung oder Verschlechterung der Formel.

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
- Synthetische Gruppen besitzen derzeit vier Personen passend zur Kapazität der synthetischen
  Flugzeuge. Der Gruppenschutz und die Queue-Planung werden dadurch geprüft, nicht unterschiedliche
  reale Produkt- oder Flottenkonfigurationen.
- Exportiert werden nur Szenario, Seed, synthetisches Ereignisledger, Flugzeuge, Umläufe,
  Prognosesnapshots und Kennzahlen. Ticketcodes, Namen, Telefonnummern, PINs und Secrets sind weder
  Teil des Modells noch des Exports. Das Format trägt die Kennung
  `rundflug-forecast-simulation/v3`.

## Browserabnahme

Die freigegebenen Konzepte unter `docs/ui/forecast-simulator-*-approved.png` wurden im lokalen
Vite-Modus mit dem In-App-Browser gegen die gerenderte Anwendung verglichen. Die Funktionsprüfung
erfolgte bei 1280×720; ergänzende Headless-Aufnahmen belegen das Layout bei 1536×1024 und 1280×800.
Light und Dark Mode wurden jeweils im In-App-Browser geprüft:

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
- eine vollständig neu geladene Browserseite enthält sinnvollen Anwendungsinhalt, kein
  Framework-Fehleroverlay und keine Konsolenfehler oder -warnungen;
- Netzwerkaufzeichnung nach Reload: ausschließlich lokale Vite-Modul- und HMR-Verbindungen,
  keine externe URL, kein `/api/`-Aufruf und kein Service-Worker-Modul.

Der normale Produktionsbuild ersetzt den Simulatorimport per Vite-Alias durch ein leeres Modul. Er
enthält weder Simulator-JavaScript noch dessen Styles; Route, Navigation und PWA-Precache können den
Simulator daher nicht erreichen.
