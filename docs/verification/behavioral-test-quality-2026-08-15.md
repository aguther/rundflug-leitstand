# Nachweis der verhaltensbasierten Testqualität

Stand: 15. August 2026

## Ziel und Prüfpolitik

Tests belegen beobachtbares Verhalten an fachlichen und technischen Grenzen. Sie dürfen produktive
TypeScript-, TSX-, JavaScript- oder MJS-Dateien nicht als Text importieren oder über das Dateisystem
lesen, um interne Funktionsnamen, SQL-Fragmente, JSX-Strukturen oder CSS-Klassen zu behaupten.
Dasselbe gilt für literale Python-Zugriffe. Zulässig bleiben Parser- und Validatorprüfungen für JSON,
YAML, Wrangler-Konfiguration, generierte Dokumente sowie Datenschutz- und Lizenzscans, weil dort das
Artefakt selbst der Vertrag ist.

Fortschreibung am 16. August 2026: Availability, Soak und Remote-Performance führen importierbare
Policy-/Szenariomodule mit injizierten Uhr-, Prozess-, HTTP-, Probe- und WebSocket-Adaptern aus. Der
Python-Restore und der Worker-Exporter lesen denselben validierten JSON-Tabellenvertrag. Release-
Versionen werden über importierte Konstanten, die tatsächliche Health-Response und ein erzeugtes
Backupmanifest geprüft; der Requirements-Verifier liest keine Produktionsimplementierung mehr.

Der gemeinsame Datenbank-Testbuilder führt die lückenlose aktive Migrationsfolge ab
`0001_v1_12_baseline.sql` in einer echten In-Memory-SQLite-Datenbank aus, aktiviert Fremdschlüssel
und bietet eine D1-kompatible Prepared-Statement-Schnittstelle. Der getrennte Baseline-Test führt
ausschließlich `0001` aus und vergleicht sie mit dem eingefrorenen semantischen Manifest.
Datenmodell- und Worker-Tests prüfen dadurch Inserts, Constraints, Trigger, Abfragen und
API-Projektionen gegen das aktuelle produktive Endschema statt gegen Teil-DDLs oder SQL-Text.

## Gemessene Coverage

`npm run test:coverage` bestand mit 306 Testdateien, 1.788 erfolgreichen und sechs übersprungenen
Tests. Die globale Coverage beträgt 81,50 % Statements, 71,99 % Branches, 80,70 % Functions und
84,01 % Lines. Die Ratchets wurden auf 81/71/80/84 angehoben.

Die zehn kritischen Domainmodule erreichen mindestens 90 % Lines und 85 % Branches:

| Modul | Lines | Branches |
| --- | ---: | ---: |
| Kapazität | 100,00 % | 89,74 % |
| Forecast-Verfügbarkeit | 99,23 % | 92,07 % |
| Forecast-Diagnostik | 94,44 % | 91,66 % |
| Forecast-Dispatch-Replay | 100,00 % | 85,07 % |
| Forecast-Projektion | 96,06 % | 94,09 % |
| Forecast-Sampling | 100,00 % | 88,88 % |
| Outage Recovery | 100,00 % | 93,75 % |
| Queue | 100,00 % | 97,67 % |
| Nachruf | 100,00 % | 100,00 % |
| Turnaround | 100,00 % | 100,00 % |

## Mutationstest und Ratchet

Ein erster Audit mit dem großen zusammengesetzten Forecast-Projektionsmodul umfasste 2.068 Mutanten
und erreichte 66,15 %. Dieser Lauf verfehlte die geplante Abbruchschwelle von 70 % und zeigte, dass
die initiale Auswahl für ein regelmäßig ausführbares Gate zu breit und nicht ausreichend fokussiert
war. Das zusammengesetzte Modul bleibt vollständig in Unit- und Coverage-Prüfungen enthalten; seine
fachlichen Teilregeln werden im initialen Mutation-Gate über fokussierte Module geprüft.

Der am 16. August fortgeschriebene reproduzierbare Gate-Lauf umfasst weiterhin neun Module aus
Queue, Kapazität, Prognose, Turnaround, Nachruf und Outage Recovery. Direkte Grenzwerttests für
Kapazität, Verfügbarkeit, Diagnostik, Dispatch-Replay und robuste Stichproben stärken die
beobachtbaren Regeln ohne Mutator-Ausschlüsse. Der vollständige Lauf bestand mit folgendem Ergebnis:

| Ergebnis | Anzahl / Wert |
| --- | ---: |
| Mutanten gesamt | 1.447 |
| Getötet | 1.255 |
| Timeout | 7 |
| Überlebt | 178 |
| Ohne Coverage | 7 |
| Mutation Score gesamt | 87,21 % |
| Mutation Score abgedeckter Code | 87,64 % |

Der erreichte Wert wird mit `break: 87`, `low: 80` und `high: 90` als globales Ratchet festgehalten.
Das zusätzliche Report-Gate verlangt mindestens 80 Prozent je ausgewähltem Modul; gemessen wurden
81,47 bis 98,15 Prozent. Ein späterer höherer reproduzierbarer Wert wird nach oben übernommen; eine
Absenkung erfordert eine ausdrückliche Architekturentscheidung.

## Automatisierung und Integrationsregel

- `npm run refactor:guardrails` verhindert Rohimporte und Dateisystemzugriffe auf produktive `.ts`-,
  `.tsx`-, `.js`- und `.mjs`-Logik sowie literale Python-Pfade und hält alle
  Produktions-Quelltextorakel bei null.
- Derselbe Befehl klassifiziert 36 Worker-SQL-Orakel-Familien reproduzierbar; alle 36 besitzen
  zusätzliche Behavior-Evidence und die Priorität-A-Liste bleibt bei null.
- `npm run test:coverage` prüft globale Coverage und anschließend die zehn kritischen Domainmodule.
- `npm run test:mutation` führt den vollständigen fokussierten Stryker-Lauf und anschließend das
  globale sowie modulbezogene Report-Ratchet aus.
- `npm run test:mutation:dry` validiert Konfiguration und Testauswahl ohne Mutation.
- Der Mutation-Job in `.github/workflows/ci.yml` läuft mit der vollständigen Branch-CI und
  veröffentlicht HTML-, JSON- sowie Incremental-Berichte als CI-Artefakte. Einen zusätzlichen
  geplanten oder manuellen Mutation-Workflow gibt es nicht.

Der Mutationstest ist damit ein allgemeines Integrationsgate und läuft parallel zu den übrigen
Branch-CI-Prüfungen. ADR-0056 dokumentiert die Fortschreibung der ursprünglichen Entscheidung aus
ADR-0046; ADR-0058 entfernt ausschließlich den zusätzlichen Zeitplan- und manuellen Workflow.
