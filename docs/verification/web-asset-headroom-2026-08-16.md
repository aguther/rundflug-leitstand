# Nachweis: dauerhafter Web-Asset-Spielraum

Datum: 16. August 2026

## Gegenstand

Der Nachweis belegt ADR-0055 und QS-21. Gemessen wurde ein frischer Produktionsbuild des Commits
`de5ed4de879c114cc202d9bf7a9822b72700e9f4`. Die absoluten Budgets blieben unverändert; das Gate
verlangt mindestens zehn Prozent Reserve. Die Vergleichsbasis ist die frühere commitgebundene
Baseline aus `web-asset-baseline-5e1dce.json`.

## Harte Assetgrenzen

| Metrik | Vorher Raw | Nachher Raw | 90-%-Grenze Raw | Vorher Gzip | Nachher Gzip | 90-%-Grenze Gzip |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Globale CSS | 96.122 B | 84.733 B | 88.239 B | 17.858 B | 16.261 B | 16.393 B |
| Flight-Line-CSS | 74.151 B | 44.204 B | 66.744 B | 11.894 B | 7.803 B | 10.739 B |
| Admin-Entry | 136.596 B | 119.022 B | 165.888 B | 39.195 B | 33.108 B | 44.236 B |
| Main-Entry | 188.458 B | 188.437 B | 198.144 B | 59.580 B | 59.580 B | 62.668 B |
| Größter JavaScript-Chunk | 320.999 B | 188.437 B | 294.676 B | 94.201 B | 59.580 B | 86.476 B |
| PWA-Precache | 1.320.293 B | 1.252.354 B | 1.255.500 B | – | – | – |

Alle gemessenen Werte erfüllen das unveränderte Hard Limit und dessen zusätzliche
Zehn-Prozent-Reserve.

## Routenratchet

| Route | Vorher Raw | Nachher Raw | Vorher Gzip | Nachher Gzip |
| --- | ---: | ---: | ---: | ---: |
| Admin | 1.253.708 B | 924.641 B | 404.450 B | 307.153 B |
| Kasse | 709.366 B | 699.794 B | 261.452 B | 260.098 B |
| FIDS | 693.254 B | 682.172 B | 248.423 B | 246.948 B |
| Flight Director | 926.897 B | 888.992 B | 310.418 B | 303.716 B |
| Flight Line | 931.187 B | 857.737 B | 310.987 B | 298.871 B |
| Gruppenstatus | 687.590 B | 677.013 B | 250.275 B | 248.894 B |
| Datenschutz | 564.424 B | 553.260 B | 212.413 B | 210.765 B |
| Einrichtung | 593.074 B | 581.871 B | 221.877 B | 220.217 B |
| Simulation | 882.666 B | 854.429 B | 292.821 B | 288.522 B |
| Ticketstatus | 688.051 B | 677.474 B | 250.568 B | 249.187 B |

Jede neue Raw- und Gzip-Baseline liegt unter ihrem Vorgänger. Das fortgeltende Gate erlaubt von
diesem abgesenkten Stand höchstens zwei Prozent Routenregression.

## Precache-Grenze

Der erzeugte Service Worker enthält die Entry-Dateien und statisch erreichbare Entry-CSS von Kasse,
FIDS, Flight Line und Flight Director. Nicht enthalten sind die direkten Entries von Administration,
Prognosesimulator und Flight-Director-Analytics, die extrahierte Analytics-CSS, das Analytics-Modell
und der Vergleichs-Worker. `policyFailures` ist in der gespeicherten Baseline leer.

## Automatisierte Prüfung

- Abschließender gezielter Lauf mit 29 Pure-, DOM- und Budgettests für SVG-Pfade, Skalen, Ticks,
  Pointer-Zuordnung, Admin-Diagramm, Flight-Director-Analytics, Flight-Line-Abläufe und Asset-Gate:
  bestanden.
- Web-Typprüfung: bestanden.
- Repository-Lint und Lizenzprüfung: bestanden.
- `npm run web:assets:report`: frischer Build und Bericht erfolgreich.
- `npm run web:assets:verify`: Hard Limits, zehn Prozent Reserve, Routenratchet und Precache-Policy
  bestanden.

## Browserabnahme

Die fachliche Interaktion wurde mit dem In-App-Browser gegen die lokale Vite-/Worker-Kombination
geprüft; die vier Abnahmebilder wurden wegen reproduzierbarer Capture-Timeouts des In-App-Browsers
mit dem vorgesehenen Playwright-Fallback erzeugt.

- Administration: Tooltip mit festem Zeitstand, Zoom von 100 auf 150 Prozent und Reset auf 100
  Prozent geprüft. Das Diagramm besitzt keine eigenen Tabstopps.
- Flight Director: vier monotone Serien mit 16 Punkten, vier Ist-Referenzen und die vertikale
  GO-TO-GATE-Referenz geprüft. Tooltip, Zoom, Pan und Reset waren bedienbar; der Pan verschob die
  sichtbaren Ticks reproduzierbar von `09:36–09:54` auf `09:40–09:58`. Das SVG besitzt keine
  eigenen Tabstopps.
- Flight Line: Auswahl- und Arbeitsmodus wurden bei 1180 × 820 und 390 × 844 geprüft. Der
  Screenshotvergleich deckte eine fehlende gemeinsame Grid-Foundation der Ist-Zeitlinie auf; nach
  der Korrektur entspricht die Achse wieder dem freigegebenen Rollenbild. Die primären
  Arbeitsaktionen bleiben 56 Pixel hoch, die Tabs 48 Pixel hoch.
- Light und Dark wurden bei 1440 × 900, 1194 × 834 und 834 × 1194 sowie für Flight Line zusätzlich
  bei 1180 × 820 und 390 × 844 ohne horizontales Überlaufen geprüft. Die Browserkonsole blieb ohne
  Warnungen und Fehler.
- Abnahmebilder: `web-asset-admin-1440x900-dark.png`,
  `web-asset-flight-director-1194x834-light.png`, `web-asset-flight-line-390x844-light.png` und
  `web-asset-flight-line-work-1180x820-dark.png`.

Der Produktionsursprung registrierte `sw.js` als aktiven Controller und enthielt den erwarteten
Workbox-Precache. Die anschließende Offline-Neuladung wechselte im In-App-Browser in dessen interne
Netzfehlerseite; die Browser-URL-Sicherheitsrichtlinie blockierte danach jede weitere kontrollierte
Inspektion. Dieser manuelle Einzelpunkt ist deshalb nicht als bestanden gewertet. Die automatisierten
Router-, Offline- und PWA-Prüfungen sowie die statische Precache-Policy bleiben für die finale
Validierung verbindlich.
