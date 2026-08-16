# ADR-0046: Verhaltensbasierte Testarchitektur und Qualitätsratchets

- Status: Akzeptiert
- Datum: 2026-08-15
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: V1120-QA-010, V1110-QA-010, Q-WAR-050, Q-ZUV-020

## Kontext

Der Bestand enthielt viele Tests, die TypeScript-, TSX- oder CSS-Dateien als Text einlasen und auf
Funktionsnamen, JSX-Fragmente, Klassennamen oder SQL-Formulierungen prüften. Solche Tests konnten
bei reinem Refactoring fehlschlagen, ohne eine Regression für Nutzer oder Persistenz zu belegen.
Gleichzeitig erhöhte das bloße Importieren von Produktionsquellen die Coverage nicht sinnvoll und
sagte nichts über die Wirksamkeit der Assertions aus.

Die D1-Baseline aus ADR-0045 ermöglicht erstmals einen gemeinsamen, vollständigen SQLite-Aufbau für
Schema- und Persistenztests. Der vorhandene Worker-Runtime-Pool sowie Testing Library und die
Browser-Verifier bilden die übrigen ausführbaren Systemgrenzen ab.

## Entscheidung

Tests werden an der kleinsten geeigneten beobachtbaren Grenze ausgeführt:

- reine Fachlogik über Zustands-, Grenzwert- und Negativtests in `packages/domain`,
- D1-Schema, Constraints, Trigger und Projektionen über die tatsächlich ausgeführte Baseline in
  einer In-Memory-SQLite-Datenbank mit aktivierten Fremdschlüsseln,
- Worker- und Cloudflare-Grenzen über den `workerd`-Pool; Mocks bleiben auf gezielte Fehler- und
  Nebenläufigkeitsinjektion beschränkt,
- React-Oberflächen über zugängliche Rollen, Namen, Tastaturbedienung, sichtbare Zustände und
  Interaktionen mit Testing Library,
- geschäftskritische Gesamtflüsse und Layoutinvarianten über die Browser-Verifier.

Tests dürfen produktive `.ts`-, `.tsx`-, `.js`- und `.mjs`-Dateien weder mit `?raw` importieren noch
mit `readFile`/`readFileSync` als Text lesen. Literale Python-Pfade dürfen Produktionslogik ebenfalls
nicht als Textvertrag verwenden. `npm run refactor:guardrails` hält diese Mengen auf null und schützt
außerdem die Adapterfreiheit des Domain-Pakets. Zulässige Artefakttests parsen und validieren JSON,
YAML, Wrangler-Konfiguration, Manifeste, generierte Dokumente und Datenschutz-Exports. Sie ersetzen
keine ausführbare Verhaltensprüfung.

SQL-Shape-Assertions an D1-Mocks gelten nur als ergänzende Diagnose. Dieselbe Invariante muss
zusätzlich an ausgeführtem SQLite-, Worker-Runtime-, HTTP- oder E2E-Verhalten geprüft werden. Der
versionierte Audit `scripts/worker-sql-test-oracles.json` klassifiziert 36 betroffene
Worker-Testfamilien, dokumentiert die Behavior-Evidence für 25 davon und führt elf noch zu
migrierende Priorität-A-Familien als getrennte technische Schuld. Das Ratchet verhindert neue
unklassifizierte SQL-Orakel-Familien.

Die globale Coverage besitzt einen vollständigen Produktionscode-Nenner und Ratchets von 81 %
Statements, 71 % Branches, 80 % Functions und 84 % Lines. Zusätzlich erzwingt
`scripts/verify_domain_coverage.mjs` für zehn kritische Domainmodule mindestens 90 % Line- und
85 % Branch-Coverage.

Mutationstests laufen für neun fachliche Kernmodule aus Kapazität, Forecast-Verfügbarkeit,
Forecast-Diagnostik, Forecast-Replay, Forecast-Sampling, Outage Recovery, Queue/Gruppenschutz,
Gruppennachruf und Turnaround. Der initial reproduzierte Score von 73,59 % ratcheted `break` auf
73; `low` bleibt 80 und `high` 90. Der große Forecast-Projektionsorchestrator ist nicht Teil dieses
ersten Mutation-Gates: Seine ausführbaren Zustands- und Skalenszenarien bleiben im normalen
Test-/Coverage-Nachweis, während die mutierten Forecast-Phasen eine fokussierte und reviewbare
Fehlerlokalisierung ermöglichen.

Mutationstests laufen wöchentlich und manuell. Vor Integration eines Branches, der eines der neun
ausgewählten Module ändert, ist `npm run test:mutation` zusätzlich verpflichtend. Der normale
PR-Basischeck bleibt davon getrennt; HTML-, JSON- und Incremental-Berichte werden als CI-Artefakt
aufbewahrt.

## Folgen

- Refactorings können interne Namen, JSX-Struktur, CSS-Klassen oder Query-Formulierungen ändern,
  solange beobachtbares Verhalten und Architekturgrenzen erhalten bleiben.
- Coverage bleibt eine notwendige, aber nicht hinreichende Aussage; der Mutation Score misst die
  Wirksamkeit der Assertions in den ausgewählten kritischen Modulen.
- Überlebende Forecast-Mutanten bilden einen priorisierten Ausbaupfad. Eine Absenkung der Ratchets
  ist nicht zulässig, nur eine begründete Präzisierung der Mutationsfläche oder zusätzliche Tests.
- Gelöschte Quelltexttests dürfen nicht als vermeintlicher Qualitätsverlust wieder eingeführt
  werden. Neue Nachweise wählen DOM-, HTTP-, Runtime-, SQLite- oder Domainverhalten.
- Coverage, SQL-Orakel und Mutation Score bleiben getrennte Messgrößen: Ausführung allein belegt
  keine wirksame Assertion, und ein SQL-Stringvergleich belegt keine Datenbankwirkung.

## Verworfene Alternativen

- **Quelltexttests nur umbenennen oder Snapshots aktualisieren:** erhält die Kopplung an
  Implementierungsdetails und liefert keinen stärkeren Regressionsnachweis.
- **Mutationstests in jeden PR-Basischeck aufnehmen:** verlängert auch unbeteiligte Änderungen
  erheblich und vermischt schnelle Integrationsgates mit einem gezielten Qualitätsaudit.
- **Den vollständigen Forecast-Orchestrator sofort mutieren:** erzeugt mehr als 600 zusätzliche
  Mutanten mit geringer Fehlerlokalisierung und verdeckt die bereits klar abgegrenzten Forecast-
  Phasen. Seine Aufnahme bleibt eine spätere Ratchet nach weiterer Modularisierung.
