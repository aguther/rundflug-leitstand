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
| Normalbetrieb | 32 / 25 | 0 % | 0,5 Min. | 23,6 Min. | 0 Min. | 29,648 Sek. |
| Stoßlast | 68 / 25 | 0 % | 0,5 Min. | 21,7 Min. | 0 Min. | 29,648 Sek. |
| Flugzeugausfall | 32 / 20 | 0 % | 1,0 Min. | 13,0 Min. | 0 Min. | 29,648 Sek. |
| Betriebsunterbrechung | 32 / 26 | 0 % | 0,5 Min. | 23,7 Min. | 0,8 Min. | 29,648 Sek. |

Die Baseline zeigt damit transparent, dass die aktuelle Prognoseformel für die meisten
Boarding-Prognosen Punktfenster statt praktisch nutzbarer Zeitspannen erzeugt. Die niedrige
Trefferquote ist kein Zielwert und wird nicht beschönigt: Der Simulator erfüllt gerade den Zweck,
diesen fehlenden operativen Mehrwert messbar zu machen. Eine Änderung der Formel ist nicht Teil
dieses Stands und muss gegen diese Baseline separat bewertet werden.

Alle vier Presets weisen `0` dargestellte Countdowns während `UNCERTAIN` aus. Ereignisbedingte
Neuberechnungen erfolgen im 30-Sekunden-Raster und liegen mit maximal 29,648 Sekunden innerhalb des
harten Prüfkriteriums.

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

- `docs/architecture/domain-state-and-forecast-v1.md` beschreibt noch eine Ausreißergrenze von
  `3×` Referenzdauer. Implementierung und Baseline verwenden unverändert die in
  `forecast-sample-policy-v1.md` festgelegte Grenze von `1,75×`. Dieser Widerspruch wird hier bewusst
  dokumentiert und nicht durch eine versteckte Algorithmusänderung aufgelöst.
- Der Simulator bildet einen unmittelbar reagierenden idealisierten Bedienablauf ab. Er trifft keine
  flugbetriebliche, technische, sicherheitsrelevante oder luftrechtliche Entscheidung.
- Der CSV-Import kalibriert ausschließlich die Zeitverteilungen. Ohne Queue- und Snapshot-Historie
  rekonstruiert er keinen historischen Veranstaltungstag.
- Synthetische Gruppen besitzen derzeit vier Personen passend zur Kapazität der synthetischen
  Flugzeuge. Der Gruppenschutz und die Queue-Planung werden dadurch geprüft, nicht unterschiedliche
  reale Produkt- oder Flottenkonfigurationen.
- Exportiert werden nur Szenario, Seed, synthetisches Ereignisledger, Umläufe, Prognosesnapshots und
  Kennzahlen. Ticketcodes, Namen, Telefonnummern, PINs und Secrets sind weder Teil des Modells noch
  des Exports.

## Browserabnahme

Die freigegebenen Konzepte unter `docs/ui/forecast-simulator-*-approved.png` wurden im lokalen
Vite-Modus mit dem In-App-Browser gegen die gerenderte Anwendung verglichen:

- 1536×1024, Light und Dark Mode;
- 1280×800, Light und Dark Mode;
- Hauptansicht bei virtueller Zeit 11:40 sowie geöffneter Szenarioeditor;
- kein horizontaler Dokument- oder Arbeitsbereichsüberlauf in beiden Viewports;
- ungültige Verteilung `Boarding 13/7/12` sperrt „Übernehmen & neu starten“, `4/7/12` gibt den
  Befehl wieder frei;
- ausgewählte unsichere Fluggruppe zeigt ausdrücklich „Countdown unterdrückt“;
- Detaildialog enthält MAE, Median, P90 und Bias für Boarding, Start, Landung und Abschluss sowie
  Horizonte, Reaktionszeit und Qualitätsverteilung;
- keine Browserfehler oder Warnungen;
- Netzwerkaufzeichnung nach Reload: ausschließlich lokale Vite-Modul- und HMR-Verbindungen,
  keine externe URL, kein `/api/`-Aufruf und kein Service-Worker-Modul.

Der normale Produktionsbuild ersetzt den Simulatorimport per Vite-Alias durch ein leeres Modul. Er
enthält weder Simulator-JavaScript noch dessen Styles; Route, Navigation und PWA-Precache können den
Simulator daher nicht erreichen.
