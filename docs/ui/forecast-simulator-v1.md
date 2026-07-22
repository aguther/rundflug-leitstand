# Prognose-Simulator – freigegebenes UI-Konzept

Stand: 22. Juli 2026

Die folgenden beiden Desktop-Konzepte sind die verbindliche visuelle Spezifikation für den lokalen
Prognose-Simulator:

- [Hauptansicht](forecast-simulator-main-approved.png)
- [Szenario-Konfiguration](forecast-simulator-scenario-approved.png)

## Verbindliche Struktur

Die Hauptansicht verwendet eine schmale Szenarioleiste, einen kompakten Wiedergabe- und
Ereignisbereich, eine dreistündige Zeitachse, eine Auswahlzusammenfassung sowie eine gemeinsame
Auswertungszeile aus Fehlerdiagramm und vier Boarding-Kennzahlen. Die virtuelle Uhr ist das stärkste
Element der Bedienzeile. Der Warnhinweis „Nur Simulation – keine Betriebsdaten“ bleibt permanent im
Kopf sichtbar.

Der Konfigurationsbereich öffnet als rechter Seiteneditor. Zeitphasen und Betriebsereignisse bleiben
in getrennten, tabellarisch aufgebauten Bereichen. Jede Dauer verwendet die Spalten Minimum,
typisch und Maximum. Das Übernehmen startet den Lauf vollständig mit demselben Seed und den neuen
Parametern neu.

## Verhalten

- `Start`, `Pause`, `+5 Min.` sowie 1×, 10×, 60× und 300× steuern ausschließlich die virtuelle Zeit.
- Tanken, ungeplante Pause, technischer Defekt, Tagesausfall und globale Betriebsunterbrechung sind
  manuell injizierbar. Flugzeugereignisse warten bei einem laufenden Umlauf bis zur nächsten
  organisatorisch zulässigen Grenze.
- Eine temporäre Flugzeugsperre endet erst mit dem synthetischen bestätigten Rückkehrereignis.
- Bei Prognosequalität `UNCERTAIN` zeigt die Oberfläche keinen Countdown, bewahrt die numerischen
  Rohwerte aber für die Diagnose im Export.
- CSV-Kalibrierung und JSON-Export bleiben vollständig lokal. Es gibt keinen Upload und keine
  dauerhafte Browser-Speicherung.
- Light und Dark Mode verwenden die bestehenden Design-Tokens. Bei schmaleren Viewports scrollt der
  Arbeitsbereich intern; der Dokumentkörper erhält keinen horizontalen Überlauf.

## Bewusste Abweichungen vom Bildinhalt

Die im Bild gezeigten Kennzahlen sind illustrative Konzeptwerte. Die implementierte Ansicht zeigt
immer die berechnete, seedbasierte Baseline. Zusätzlich zum Konzept ist ein eigener Button für einen
temporären technischen Defekt vorhanden, damit alle unterstützten Störungsarten direkt prüfbar sind.
Die Flugzeugkennungen sind ausschließlich synthetisch (`D-SIM01` usw.).
