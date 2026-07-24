# Prognose-Simulator – freigegebenes UI-Konzept

Stand: 23. Juli 2026

Die folgenden sechs Desktop-Konzepte sind die verbindliche visuelle Spezifikation für den lokalen
Prognose-Simulator:

- [Hauptansicht](forecast-simulator-main-approved.png)
- [FIDS-Einstieg in der Hauptansicht](forecast-simulator-fids-entry-approved.png)
- [Simuliertes Live-FIDS](forecast-simulator-fids-approved.png)
- [Szenario-Konfiguration](forecast-simulator-scenario-approved.png)
- [Verlauf einer Fluggruppe](forecast-simulator-group-history-approved.png)
- [Tagesverlauf eines Flugzeugs](forecast-simulator-aircraft-history-approved.png)

Die beiden Verlaufsbilder wurden am 23. Juli 2026 freigegeben; ihre fachlichen Details sind in der
[Verlaufsauswertung](forecast-simulator-history-approved.md) festgehalten.
Die am 23. Juli 2026 beauftragte Erweiterung des Szenarioeditors und der A/B-Auswertung ist im
[Tuning-Konzept](forecast-simulator-tuning-approved.md) verbindlich beschrieben.

## Verbindliche Struktur

Die Hauptansicht verwendet eine schmale Szenarioleiste, einen kompakten Wiedergabe- und
Ereignisbereich, eine dreistündige Zeitachse, eine Auswahlzusammenfassung sowie eine gemeinsame
Auswertungszeile aus Fehlerdiagramm und vier Boarding-Kennzahlen. Die virtuelle Uhr ist das stärkste
Element der Bedienzeile. Der Warnhinweis „Nur Simulation – keine Betriebsdaten“ bleibt permanent im
Kopf sichtbar.

Der Konfigurationsbereich öffnet als rechter Seiteneditor mit den Registern `Betrieb`,
`Simulierte Realität` und `Prognose-Labor`. Admin-Planwerte und reale Dreiecksverteilungen bleiben
getrennt. Das Übernehmen startet den Lauf vollständig mit demselben Seed und den neuen Parametern
neu.

Die `Verlaufsauswertung` öffnet als breiter Dialog mit den Registern `Fluggruppen` und `Flugzeuge`.
Die Gruppenansicht zeigt jeden einzelnen Prognosesnapshot samt realisierten Meilensteinen. Die
Flugzeugansicht zeigt ausschließlich ab bestätigtem Boarding gebundene Umläufe sowie Sperren und
bestätigte Rückkehrereignisse.

Das simulierte FIDS wird über `FIDS öffnen` im Kopf der Hauptansicht als separates, skalierbares
Browserfenster geöffnet. Es kann neben dem Simulator oder auf einem zweiten Bildschirm stehen und
verwendet den bestehenden FIDS-Aufbau mit synthetischen `G-SIM-####`-Kennungen, dem aktuellen
Szenarionamen, acht Zeilen und einspaltigem Layout. Der kompakte Hinweis
`Nur Simulation – keine Betriebsdaten`, `LIVE-SIMULATION` und `Virtuelle Zeit` grenzen die Anzeige
dauerhaft vom operativen FIDS ab. Ein Einstellungszugang ist in dieser Variante nicht vorhanden.

## Verhalten

- `Start`, `Pause`, `+5 Min.` sowie 1×, 10×, 60× und 300× steuern ausschließlich die virtuelle Zeit.
- Das simulierte FIDS folgt derselben virtuellen Zeit und ausschließlich bereits sichtbaren
  Gruppen-, Meilenstein- und Prognosedaten. Wiederholtes Öffnen fokussiert dasselbe Fenster; beim
  Verlassen des Simulators wird es geschlossen.
- Ein beobachteter Abflug bleibt unabhängig von der Simulationsgeschwindigkeit 15 Sekunden realer
  Betrachtungszeit als `ABGEFLOGEN` sichtbar. Neustart, Rücksprung oder neu berechnetes Ergebnis
  verwerfen diese reine Anzeigehistorie.
- Tanken, ungeplante Pause, technischer Defekt, Tagesausfall und globale Betriebsunterbrechung sind
  manuell injizierbar. Flugzeugereignisse warten bei einem laufenden Umlauf bis zur nächsten
  organisatorisch zulässigen Grenze.
- Eine temporäre Flugzeugsperre endet erst mit dem synthetischen bestätigten Rückkehrereignis.
- Der automatische Voraufruf `GO TO GATE` verwendet dieselbe adaptive Domain-Logik wie der Worker.
  Er wird als eigener Zeitpunkt vor Boarding festgehalten und bindet noch kein Flugzeug. Die
  produktionsnahen Betriebsparameter enthalten nur die Aktivierung; technische Werte sind deutlich
  als lokales Experiment gekennzeichnet.
- Bei Prognosequalität `UNCERTAIN` zeigt die Oberfläche keinen Countdown. Auswahlzusammenfassung
  und Detaildialog kennzeichnen die numerischen Rohwerte ausdrücklich als nicht freigegebene
  Diagnose und nennen Unterdrückungsgrund, Lernwertalter, Stichprobengröße und aktive Kapazität.
- Der lokale JSON-Export `rundflug-forecast-simulation/v4` enthält getrennte Admin-, Realitäts- und
  Tuningparameter, einen optionalen A/B-Vergleich, Rohwerte, explizite
  Unterdrückungsgründe, Voraufrufdiagnostik sowie die normalisierte Flugzeug- und Ereignishistorie;
  sie besitzen keine operative oder öffentliche Zeitsemantik.
- CSV-Kalibrierung und JSON-Export bleiben vollständig lokal. Es gibt keinen Upload und keine
  dauerhafte Browser-Speicherung.
- Auch das FIDS-Pop-out wird direkt aus dem React-Zustand des Simulatorfensters gerendert. Es
  verwendet keine zusätzliche Route, API, WebSocket-Verbindung, BroadcastChannel- oder
  Service-Worker-Kommunikation.
- Light und Dark Mode verwenden die bestehenden Design-Tokens. Bei schmaleren Viewports scrollt der
  Arbeitsbereich intern; der Dokumentkörper erhält keinen horizontalen Überlauf.

## Bewusste Abweichungen vom Bildinhalt

Die im Bild gezeigten Kennzahlen sind illustrative Konzeptwerte. Die implementierte Ansicht zeigt
immer die berechnete, seedbasierte Baseline. Zusätzlich zum Konzept ist ein eigener Button für einen
temporären technischen Defekt vorhanden, damit alle unterstützten Störungsarten direkt prüfbar sind.
Die Flugzeugkennungen sind ausschließlich synthetisch (`D-SIM01` usw.).
