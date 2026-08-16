# SQL-Shape-Orakel in Worker-Tests

- **Status:** offen
- **Priorität:** mittel
- **Audit:** `scripts/worker-sql-test-oracles.json`, reproduzierbar über
  `npm run refactor:guardrails`
- **Stand:** 36 klassifizierte Testfamilien; 25 mit zusätzlichem Verhaltensnachweis, elf Fälle der
  Priorität A noch zu migrieren

## Sachverhalt

Ein SQL-Shape-Orakel prüft beispielsweise, ob ein D1-Mock einen String mit `UPDATE operation_days`,
einer bestimmten `WHERE`-Klausel oder einer erwarteten Anzahl vorbereiteter Statements erhalten hat.
Das ist als ergänzender Diagnosebeleg nützlich, führt die Abfrage aber nicht aus. Der Test kann daher
grün bleiben, obwohl das SQL syntaktisch ungültig ist, ein Join Zeilen vervielfacht, ein Trigger oder
Fremdschlüssel die Mutation ablehnt oder die HTTP-Response fachlich falsch projiziert wird.

Der reproduzierbare Audit erfasst Worker-Testdateien der Familien `*service.test.ts`,
`*history.test.ts` und `*routes.test.ts` mit direkten SQL-Text- oder Statement-Helper-Assertions.
Er klassifiziert exakt 36 Dateien:

- 25 Dateien verwenden SQL-Shape nur ergänzend zu HTTP-, Runtime-, SQLite- oder
  V1-Integrationsverhalten. Die zugehörige Evidence steht dateischarf im Audit.
- Elf Priorität-A-Dateien besitzen noch Invarianten, deren stärkstes lokales Orakel die vorbereitete
  Statementform ist. Sie bleiben als offene Schuld bestehen.

## Priorität A

| Familie | Noch verhaltensbasiert abzusichernde Wirkung |
| --- | --- |
| `analysis-archive-service.test.ts` | Claim-, Zustands- und Katalogübergänge tatsächlich in SQLite sowie R2-/D1-Fehlerwirkung |
| `analysis-snapshot-capture-service.test.ts` | konsistente Snapshotmenge, Referenzketten und atomare Katalogfortschreibung |
| `event-administration-command-service.test.ts` | Lebenszyklus-, Versions-, Audit-, Receipt- und Outboxwirkung eines real ausgeführten Kommandos |
| `forecast-history.test.ts` | Filter, Reihenfolge und Begrenzung tatsächlich gelesener Forecast-Snapshots |
| `history-routes.test.ts` | Rollenfilter, Cursor und HTTP-Projektion gegen echte relationale Historie |
| `master-data-command-service.test.ts` | Gate-/Produkt-/Ressourceninvarianten und atomare Persistenzpläne in SQLite/Runtime |
| `operational-control-command-service.test.ts` | Zustandsänderung, Audit, Receipt und Outbox unter Fehler- und stale-write-Szenarien |
| `operational-history.test.ts` | Ereignisfilter, Sortierung und Seitenübergänge aus echten Daten |
| `operations-read-service.test.ts` | Join-Kardinalitäten, Aggregationen und Veranstaltungstrennung der Read Models |
| `resource-day-history.test.ts` | tagesbezogene Ressourcenfilter und chronologische Projektion |
| `ticket-read-routes.test.ts` | Such-, Verkäufer-, Status- und Cursorfilter in tatsächlichen HTTP-/SQLite-Ergebnissen |

## Abgrenzung zu anderen Testqualitätsmaßen

| Maß | Aussage | Aktueller Status |
| --- | --- | --- |
| Quelltextorakel | prüft Implementierungswörter in `.ts`, `.tsx`, `.js` oder `.mjs` statt Verhalten | behoben; Guardrail hält Rohimporte, Dateilesezugriffe und literale Python-Zugriffe auf Produktionslogik bei null |
| SQL-Shape-Orakel | prüft die Form vorbereiteter D1-Statements | dieser Eintrag; elf Priorität-A-Familien offen |
| Coverage | belegt, dass Code während Tests ausgeführt wurde | Ratchets etabliert; keine Aussage, ob eine Assertion einen Fehler erkennen würde |
| Mutationstest | verändert Code gezielt und misst, ob Tests die Änderung erkennen | getrennte offene Schuld in `mutation-test-effectiveness.md` |

## Ratchet und sicherer Abbau

Der Audit schlägt fehl, wenn eine neue erfasste SQL-Orakel-Familie hinzukommt, ein behobener Fall
ohne Baseline-Anpassung wieder erscheint, die Gesamtklassifikation nicht 36 oder die Priorität A
nicht elf Dateien umfasst. Eine SQL-Assertion darf nur in der behavior-backed-Gruppe verbleiben,
wenn die gleiche Invariante zusätzlich an SQLite-, Worker-Runtime-, HTTP- oder E2E-Verhalten
belegt und diese Evidence im Audit referenziert ist.

Priorität A wird schrittweise auf den gemeinsamen In-Memory-SQLite-Builder, den Worker-Runtime-Pool
oder ein HTTP-/V1-Szenario migriert. Ergänzende SQL-Assertions können danach als Diagnose bestehen
bleiben; sie dürfen nicht das einzige fachliche Orakel sein.

## Abschlusskriterium

Der Eintrag wird entfernt, wenn alle elf Priorität-A-Dateien die benannten Invarianten durch
ausgeführtes SQLite-, Runtime-, HTTP- oder E2E-Verhalten prüfen, der Audit null
`priorityAFiles` ausweist und weiterhin keine neue reine SQL-Orakel-Familie zulässt. Die getrennte
Mutationstest-Schuld bleibt davon unberührt.
