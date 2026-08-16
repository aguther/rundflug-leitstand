# Komplexität der Worker-Orchestrierung

- **Status:** offen
- **Priorität:** mittel
- **Evidenz:** `master-data-command-service.ts` umfasst 1.218 logische Zeilen,
  `operations-read-service.ts` 862 und `operations-routes.ts` 966. Die Werte stammen aus dem
  verpflichtenden Größenratchet vom 16. August 2026.

## Sachverhalt

Der Befund bezeichnet keine einzelne langsame Funktion und auch nicht lediglich „zu große Dateien“.
In drei Worker-Bausteinen treffen jeweils mehrere Verantwortungen zusammen, deren Änderungen
unterschiedliche fachliche Invarianten berühren:

| Baustein | Heute gebündelte Verantwortung | Gefährdete Grenze bei Änderungen |
| --- | --- | --- |
| `master-data-command-service.ts` | Gate- und Produktpflege, Produktreihenfolge, Flugzeug- und Ressourcengruppenpflege, Mitgliedschaften, Turnaround-Overrides und Löschplanung | genau eine Ressourcengruppe je Produkt, höchstens eine aktive Ressourcengruppenzuordnung je Flugzeug, Schutz offener Tickets sowie atomare Version-, Audit-, Idempotenz- und Outbox-Fortschreibung |
| `operations-read-service.ts` | vierzehn gebündelte D1-Read-Models für Produkte, Umläufe, Queues, Dispatch-Leases, Flotte, Piloten, Gates, Pläne, Regeln und Kennzahlen sowie ein zusätzlicher Assist-Read | alle Teilmengen müssen zum selben Veranstaltungskontext gehören; Filter, Aggregationen und Join-Kardinalitäten dürfen keine Tickets verdoppeln oder aktive Zuordnungen verlieren |
| `operations-routes.ts` | Autorisierung und Ereignislesen, Indexaufbau, Forecast-Fallbacks, Dispatch-, Kapazitäts-, Plan- und Nachrufprojektion sowie Abbildung der vollständigen Operations-Response | Rollen- und Datenminimierung, Trennung von Plan/Prognose/Ist, Gruppenschutz, Forecast-Frische und konsistente Versionssicht der Bedienoberflächen |

Ein kleiner Änderungswunsch – etwa ein neues Produktfeld oder ein zusätzlicher Boardstatus – kann
deshalb gleichzeitig SQL, Projektion, Forecast und Persistenzplanung verändern. Die Gefahr liegt in
der großen semantischen Änderungsfläche: Ein mechanisch korrektes Refactoring kann trotzdem eine
Autorisierungsprüfung verschieben, eine Batch-Grenze auflösen oder unterschiedliche Read-Zeitpunkte
vermischen.

## Wirkung

- Reviews müssen mehr voneinander unabhängige Regeln gleichzeitig nachvollziehen; unbeabsichtigte
  Seiteneffekte werden schwerer lokalisierbar.
- Unit-Tests können Teilentscheidungen nur mit großen D1- oder Route-Harnesses erreichen. Das
  erschwert gezielte Grenz-, Konflikt- und Fehlerinjektionstests.
- Änderungen an Master Data oder Operations besitzen überproportionalen Regressionsradius für
  Gruppenschutz, aktive Ressourcenzuordnung, Forecast und das operative Read Model.
- Eine Aufteilung allein nach Dateigröße wäre riskant, weil Autorisierung, erwartete Version,
  Idempotenz, Audit, Outbox und Persist-before-publish gemeinsam erhalten bleiben müssen.

## Sicherer Abbau

1. Für Gate/Produkt, Ressourcengruppe/Flugzeug, Reihenfolge/Overrides und Löschung werden typisierte
   Entscheidungs- und Persistenzpläne mit eigenen Verhaltenstests extrahiert. Die gemeinsame
   Commit-Grenze bleibt im aufrufenden Command-Service.
2. Die vierzehn Operations-Reads werden in fachlich benannte Read-Model-Gruppen zerlegt. Ein
   Orchestrator hält Veranstaltung, Projektionszeitpunkt und D1-Batch zusammen und validiert die
   erwarteten Mengenbeziehungen.
3. `operations-routes.ts` wird auf Transport, Autorisierung und Response-Mapping reduziert.
   Forecast-, Dispatch- und Kapazitätsprojektionen werden als reine Funktionen auf vorindizierten
   Read Models ausgeführt.
4. Vor jeder Extraktion sichern SQLite-, HTTP- und V1-Integrationsnachweise Rollen, Konflikte,
   Gruppenschutz, aktive Zuordnungen, Audit/Outbox sowie Persist-before-publish. SQL-Textvergleiche
   gelten dabei höchstens als ergänzender Diagnosebeleg.

## Abschlusskriterium

Der Eintrag wird erst entfernt, wenn alle folgenden Punkte erfüllt sind:

- die drei benannten Dateien liegen innerhalb neu abgesenkter, nicht wieder anhebbarer Ratchets;
- jede oben genannte Verantwortungsgruppe besitzt eine eigene typisierte Schnittstelle und kann ohne
  den vollständigen Routen- oder Command-Harness verhaltensbasiert geprüft werden;
- Operations-Reads belegen Veranstaltungskonsistenz, Kardinalität und Filterwirkung durch echte
  SQLite-Ergebnisse, nicht nur durch SQL-Shape-Assertions;
- Rollen-, stale-write-, Idempotenz-, Gruppen-, Ressourcen-, Audit-, Outbox- und
  Persist-before-publish-Nachweise bestehen unverändert im Worker-Runtime- und V1-Integrationstest;
- die Extraktion führt zu keiner Verschlechterung des Operations-/Forecast-p95 über das bestehende
  Performancebudget.
