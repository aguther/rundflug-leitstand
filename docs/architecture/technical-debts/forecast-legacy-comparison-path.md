# Legacy-Prognosepfad

- **Status:** offen
- **Priorität:** mittel
- **Evidenz:** `packages/domain/src/forecast-projection.ts` enthält weiterhin den privaten Pfad
  `calculateLegacyForecastTimelines`; ADR-0041 definiert dessen Übergangs- und Abschaltregeln.

## Wirkung

Die produktive Prognose besitzt weiterhin einen zusätzlichen internen Vergleichs- und
Übergangspfad. Er vergrößert die fachlich kritische Projektionsfläche und erschwert Änderungen an
Historienbasis, Unsicherheit, Kapazität und Zeitfenstern.

## Sicherer Abbau

Der Legacy-Pfad erhält keine neuen Fachregeln. Seine Entfernung erfolgt als eigenes Arbeitspaket
erst, wenn zwei aufeinanderfolgende freigegebene Releases die in ADR-0041 genannten Forecast-,
Integration-, Abnahme-, Replay- und Skalierungsnachweise ohne Invariantenabweichung bestanden haben.
Der Nachweis verwendet ausschließlich synthetische Daten.

## Abschlusskriterium

`calculateLegacyForecastTimelines` und sein Vergleichsaufruf sind entfernt, der festgelegte
Replay-Korpus bleibt vollständig grün, Snapshot- und Performance-Baselines sind aktualisiert und ein
Nachfolge-ADR dokumentiert die Abschaltung.
