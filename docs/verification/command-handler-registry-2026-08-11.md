# Nachweis der typisierten Command-Handler-Registry

Stand: 2026-08-11

## Verbindliche Struktur

`EventCoordinator.handleCommand` behält die gemeinsame Präambel für Vertragsprüfung,
Geräte-/Sitzungsprüfung, Rollenrecht, Idempotenz, erwartete Event- oder Aggregatversion und optionale
Planeintragsbindung. Erst danach wird das bereits validierte `CommandEnvelope` über
`command-handler-registry.ts` dispatcht. `event-command-handlers.ts` erzeugt die konkrete,
Cloudflare-unabhängige Zuordnung zu den Familiendiensten. Die Registry ist als gemappter Typ über der
discriminated Union aufgebaut. Fehlt für einen neuen Commandtyp ein Eintrag oder passt die Payload
nicht zum Handler, schlägt `npm run typecheck` fehl.

Die einzige notwendige Typ-Erasure liegt gekapselt im dynamischen Lookup der zuvor vollständig
geprüften Registry. Es gibt keinen `COMMAND_NOT_IMPLEMENTED`-Fallback mehr. Persistenz, Audit,
Idempotenzbeleg und Outbox bleiben in den bestehenden Familiendiensten beziehungsweise beim
Ticketverkauf in einem unveränderten D1-Batch.

## Familien und Verhaltensnachweise

| Familie | Beispiele | Rollen/Idempotenz/Version/Audit/Persistenz |
| --- | --- | --- |
| `product-sales` | Verkauf, Verkaufsfreigabe | `test:vertical-slice`, `test:sale-guards`, `ticket-sales-command-service.test.ts`, `product-sales-command-service.test.ts`, `product-sales-policy.test.ts` |
| `outage-recovery` | Staging, Freigabe, Anwendung | `outage-recovery-command-service.test.ts`, `test:outage-recovery` |
| `pilot-assignment` | Flugzeug-/Pilotenzuweisung | `pilot-assignment-command-service.test.ts`, `test:pilot-conflict` |
| `planned-operations` | Planeintrag, Storno, Slowdown | `planned-operation-command-service.test.ts`, `planned-operation-audit-reason.test.ts` |
| `recurring-operational-rules` | Regelpflege | `recurring-operational-rule-command-service.test.ts`, `test:recurring-operational-rules` |
| `fleet-administration` | Flugzeugzustand, Tanken, Pilotpause | `fleet-administration-command-service.test.ts`, `test:fleet-operations` |
| `event-administration` | Geräte, Parameter, Lifecycle | `test:first-run-setup`, `test:master-data`, `test:factory-reset` |
| `master-data` | Gates, Produkte, Ressourcen, Flugzeuge | `master-data-command-service.test.ts`, `test:master-data` |
| `operational-control` | Notfall, Unterbrechung, Ressourcenstatus | `test:emergency-mode`, `test:sale-guards`, `command-preflight.test.ts` |
| `rotation-recovery` | Aufrufwiderruf, Umlaufabbruch | `test:fleet-operations`, `test:vertical-slice` |
| `attendance` | Anwesenheit, Nachruf, No-Show | `ticket-group-recall-persistence-service.test.ts`, `test:ticket-group-recall`, `test:ticket-deferrals` |
| `rotation-correction` | Notiz, Kapazität, Verschiebung, Manifest | `rotation-note-command-service.test.ts`, `rotation-correction-command-service.test.ts`, `test:ticket-corrections` |
| `ticket-group-mutation` | Storno, Zurückstellung, No-Show | `ticket-group-mutation-command-service.test.ts`, `test:ticket-corrections`, `test:ticket-deferrals` |
| `rotation-transition` | Aufruf, Offblock, Landung, Turnaround | `rotation-transition-command-service.test.ts`, `test:vertical-slice`, `test:queue-grouping` |
| `operational-note` | Betriebshinweis | `operational-note-permission.test.ts`, `audit-coverage.test.ts` |

Die V1-Kernintegrationen führen die Familien über den echten HTTP-/Durable-Object-Pfad aus. Damit
prüfen sie ergänzend zu den vorhandenen Service-Units die gemeinsame Präambel, gespeicherte
Idempotenzantworten, stale-write-Ablehnung, append-only Audit und den atomaren D1-Batch.
`event-coordinator-command-registry.test.ts` instanziiert zusätzlich die isolierte Registry-Grenze und
ruft jeden registrierten Commandtyp genau einmal auf. Damit bleiben nicht nur die Schlüssel, sondern
auch deren ausführbare Familienweiterleitung unter Regressionstest.

## Struktureller Ratchet

Der EventCoordinator sinkt von 1.394 auf 839 Zeilen. `scripts/refactor-guardrails.json` schreibt diesen
Wert sowie eigene Budgets für Registry-Fabrik, Registry und Ticketverkaufsservice fest. Die
Verkaufspersistenz wurde nur mechanisch in `ticket-sales-command-service.ts` verschoben; Reihenfolge
und Inhalt des D1-Batches sind unverändert.
