# ADR-0041: Modulare Forecast-Pipeline und Abschaltung des Legacy-Vergleichspfads

- Status: Akzeptiert
- Datum: 2026-08-12
- Entscheidung: Strukturierung einer bestehenden Prognosefunktion ohne fachliche Vertragsänderung
- Betroffene Anforderungen: F-PRG-010 bis F-PRG-120, F-FLN-120, Q-WAR-060, Q-PER-030

## Kontext

Der Worker führte Laden, Normalisieren, Fachberechnung, Voraufrufentscheidung, D1-Persistenz,
Push-Zustellung und WebSocket-Veröffentlichung in `forecast-timeline-service.ts` aus. Die reine
Fachberechnung lag zugleich mit Typen, Sampling, Verfügbarkeitsbahnen und Diagnostik in
`packages/domain/src/forecast.ts`. Beide Dateien erschwerten isolierte Tests, sichere Änderungen und
die Kontrolle der Persist-before-publish-Reihenfolge.

Die aktuelle Projektion verwendet für bereits laufende Umläufe weiterhin Ergebnisse des älteren
linearen Projektionspfads als Ausgangsbasis. Dieser interne Vergleichs- und Übergangspfad ist keine
zweite öffentliche API, war bisher aber weder als bewusste Übergangslösung noch mit einem
Abschaltkriterium dokumentiert.

## Entscheidung

- `ForecastTimelineService` bleibt der kleine Orchestrator und ruft in fester Reihenfolge
  `ForecastTimelineLoader`, den reinen `projectForecastTimelineInput`, die Domain-Projektion,
  `evaluateAutomaticPrecalls`, `ForecastTimelineRepository` und `ForecastPublicationService` auf.
- Der Loader ist der einzige lesende D1-Adapter der Pipeline und weist eine angeforderte veraltete
  Event-Version vor jeder Berechnung mit `ANALYSIS_SNAPSHOT_STALE_VERSION` zurück.
- Der Projector normalisiert geladene Zeilen ohne Cloudflare-Zugriff in `ForecastTimelinesInput`.
  Fachliche Projektion und Voraufrufauswahl bleiben deterministisch und übergeben Zeit explizit.
- Das Repository bündelt Forecast-Updates, Snapshots, Voraufrufentscheidung, Audit und Outbox. Push
  und WebSocket-Veröffentlichung erfolgen weiterhin ausschließlich nach erfolgreicher Persistenz.
- Die Domain ist nach `forecast-types`, `forecast-sampling`, `forecast-availability`,
  `forecast-projection` und `forecast-diagnostics` getrennt. `forecast.ts` bleibt als kompatible
  Exportfassade bestehen; Cloudflare-, D1-, HTTP- und React-Abhängigkeiten bleiben ausgeschlossen.
- Größenbudgets in `scripts/refactor-guardrails.json` verhindern, dass Orchestrator oder Fassade
  wieder Fach- beziehungsweise Adapterlogik aufnehmen.

## Legacy-Abschaltkriterium

`calculateLegacyForecastTimelines` bleibt vorläufig privat in `forecast-projection.ts` und darf nicht
von neuen Aufrufern verwendet werden. Es wird in einem eigenen, reviewbaren Arbeitspaket entfernt,
sobald alle folgenden Bedingungen gleichzeitig erfüllt sind:

1. zwei aufeinanderfolgende freigegebene Releases bestehen Forecast-Unit-, V1-Core-Integration-,
   Acceptance-Day-, Replay- und Skalierungstests ohne Abweichung der bestätigten operativen
   Invarianten;
2. der synthetische Replay-Korpus deckt mindestens leere Kapazität, ungeeignetes Flugzeug,
   laufenden Umlauf, geplante Sperre und Verlangsamung, Operationsende, Mehrsegmentgruppe sowie
   gesperrten Dispatch-Batch deterministisch ab;
3. keine Produktions- oder personenbezogenen Daten werden als Abschaltnachweis benötigt;
4. die Entfernung erhält einen eigenen ADR-Eintrag und aktualisiert Forecast-Snapshots sowie
   Performance-Baselines im selben Auftrag.

Bis dahin darf der Legacy-Pfad nur verkleinert oder durch zusätzliche Vergleichstests abgesichert,
nicht jedoch um neue Fachregeln erweitert werden.

## Folgen und Wiederherstellung

Die Pipeline besitzt prüfbare Verantwortungsgrenzen und behält ihre bisherige öffentliche API. Die
Aufteilung verändert weder Datenbankschema noch persistierte Verträge; ein Rollback erfolgt durch
Bereitstellung des vorherigen Workers. Eine Datenreparatur oder Migration ist nicht erforderlich.

Der reine Projector kann mit synthetischen Zeilen getestet werden, Loader und Repository bleiben als
schmale D1-Adapter isolierbar. Das Projektionsmodul bleibt bis zur dokumentierten Legacy-Abschaltung
der größte Domain-Baustein; sein eigenes Ratchet verhindert weiteres Wachstum über den aktuellen
Stand hinaus.
