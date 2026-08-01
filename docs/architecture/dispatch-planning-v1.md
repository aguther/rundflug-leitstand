# Dispatch-Planung V1

## Zweck und Abgrenzung

Die Dispatch-Planung optimiert die nächste begrenzte Menge operativer Batches auf Durchsatz,
Fairness und Stabilität. Sie bindet kein Flugzeug endgültig, startet kein Boarding und trifft keine
flugbetriebliche Entscheidung. Die menschliche Bestätigung in Flight Line oder Flight Director
bleibt maßgeblich.

## Ausgangsanalyse

Vor ADR-0032 verwendete `packages/domain/src/forecast.ts` eine sequenzielle Queue-Reservierung. Der
Worker leitete den Vorabruf aus einem Queue-Präfix ab; die Flight Line präsentierte keine
versionierte Batch-Empfehlung. Die Folgen waren freie Restplätze, Blockierung durch nicht passende
Vordergruppen, fehlende Produktfairness sowie mögliche Abweichungen zwischen Produktion und
Simulator. ADR-0029 hatte dieses Queue-Präfix ausdrücklich stabil und überholungsfrei definiert.

## Verantwortlichkeiten

| Schicht | Verantwortung |
| --- | --- |
| `packages/domain/src/dispatch-plan.ts` | Reiner begrenzter Planer, Zielordnung, stabile IDs, Gründe |
| `packages/domain/src/forecast.ts` | Einmalige Bahnreservierung je Batch und identische Fenster je Mitglied |
| `packages/domain/src/precall.ts` | Dispatch-basierte Zustandsentscheidung und normalisierte Lernbeobachtung |
| `apps/worker/src/event-coordinator.ts` | D1-Lesen/-Schreiben, alte Planrevision, atomare Persistenz, Audit, Outbox |
| `packages/contracts/src/index.ts` | Strikte Transportverträge und kompatible Standardwerte |
| `apps/web` | Darstellung, Vorauswahl und explizite menschliche Bestätigung |
| Simulator | Ausführung derselben Domainlogik und Metrikbildung |

## Datenfluss

1. Der Event-Coordinator liest offene vollständige Fluggruppen, Queue-Metadaten, aktuelle
   Verpflichtungen, Produkt-Service-Schulden und verfügbare Flugzeug-/Piloten-Bahnen.
2. `createDispatchPlan` liefert Plan-ID, Revision, Batches, Gruppenentscheidungen und explizite
   Nichtplanungsgründe.
3. `calculateForecastTimelines` reserviert je Batch genau einmal eine Bahn und projiziert dasselbe
   Boardingfenster auf alle Mitglieder.
4. `selectAutomaticPrecalls` berücksichtigt ausschließlich frische, nahe Dispatch-Batches. Der
   effektive Vorlauf setzt sich aus adaptivem Basiswert und Gate-Wegvorlauf zusammen.
5. D1 speichert Projektion und Entscheidungsdiagnostik. Erst danach werden Realtime- und
   Outbox-Nachrichten veröffentlicht.
6. `CALL_NEXT` akzeptiert die Empfehlung nur bei passender Planrevision, Batch-ID, Flugzeug und
   unveränderter Gruppenmenge. Andernfalls wird `DISPATCH_PLAN_STALE` zurückgegeben.

## Begrenzung und Laufzeit

Die Standardgrenzen sind 36 Gruppen je Ressourcengruppe, 18 je Produkt, vier Wellen, 64 Kandidaten
je Schritt und Beam-Breite 24. Der Simulator verwendet für schnelle Mehrfachläufe kleinere, aber
fachlich identische Grenzen. Die Kandidatenerzeugung kombiniert ausschließlich vollständige Gruppen
eines Produkts bis zur Sitzkapazität. Alle Sortierungen enden mit stabilen IDs. Gleiche Eingaben
erzeugen bitgleich denselben Plan; Eingabeobjekte werden nicht verändert.

## Persistenz und Kompatibilität

Migration `0060_dispatch_planning_and_gate_travel_lead.sql` ergänzt Gate-Wegvorlauf,
Planmetadaten an Umläufen und Forecast-Snapshots sowie historische Vorabrufkomponenten. Alte
Stammdatenimporte ohne `travelLeadMinutes` bleiben durch den Standardwert `0` gültig. Backup,
Wiederherstellung, Ereigniskopie, Stammdatenvorlage und Simulationsplan transportieren das Feld.

## Operative Invarianten

- Ein Batch ist produktrein, gruppenatomar und kapazitätskonform.
- Ein Ticket bleibt höchstens einem nicht abgeschlossenen Umlauf zugeordnet.
- Eine Empfehlung ist keine dauerhafte Flugzeugbindung; erst `CALL_NEXT` bestätigt sie.
- `COME_TO_FLIGHT_LINE` wird bei unverändert passender Bahn nicht automatisch umgeplant.
- Ressourcenverlust darf neu planen, aber keine Gruppe duplizieren oder teilen.
- Fehlende Prognosekapazität erzeugt Grund und leeres Fenster, niemals einen künstlichen Nullwert.
- Alle bestätigten operativen Zustandsänderungen bleiben versioniert, idempotent und auditiert.

## Tests und Betrieb

Die fachliche Matrix A–K liegt in `packages/domain/src/dispatch-plan.test.ts`,
`packages/domain/src/forecast.test.ts`, `packages/domain/src/precall.test.ts` sowie den Worker- und
Simulator-Tests. Der lokale Reset mit Migration und Seed wird über `npm run db:reset:local`
verifiziert. Vollständige Freigabeprüfungen erfolgen mit `npm run check` und
`npm run requirements:verify`.
