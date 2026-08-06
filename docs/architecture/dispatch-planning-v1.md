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
3. `calculateForecastTimelines` reserviert je nahem Batch genau einmal eine Bahn und projiziert
   dasselbe Boardingfenster auf alle Mitglieder.
4. Die verbleibenden Gruppen werden anschließend mit derselben stabilen Prioritätsordnung linear auf
   die fortgeschriebenen Bahnen gelegt. Dieser Langzeitschwanz füllt produkt- und gatereine Batches
   aus ganzen Gruppen, verwendet aber keine Beam-Suche und ist keine operative Empfehlung.
5. `selectAutomaticPrecalls` berücksichtigt ausschließlich frische, nahe Dispatch-Batches. Der
   effektive Vorlauf setzt sich aus adaptivem Basiswert und Gate-Wegvorlauf zusammen.
6. D1 speichert Projektion und Entscheidungsdiagnostik. Erst danach werden Realtime- und
   Outbox-Nachrichten veröffentlicht.
7. Aktive Boarding-Leases werden als gesperrte Batch-/Flugzeugzuordnungen in die nächste globale
   Planung übernommen. Ihre Gruppen und ihre reservierte Flugzeugkapazität stehen dem Restplan nicht
   erneut zur Verfügung.
8. Der Zuweisungsdialog übernimmt den frühesten unreservierten, vollständig aufgerufenen Batch des
   zur Veranstaltungsversion passenden globalen Plans, der in das geöffnete Flugzeug passt. Fehlt
   ein aktueller Plan, wird vor dem Lease-Erwerb global neu geplant; eine dialoglokale
   Ein-Wellen-Ersatzplanung existiert nicht.
9. `CALL_NEXT` akzeptiert die Empfehlung nur bei passender Lease-ID, Batch-ID, Flugzeug und
   unveränderter Gruppenmenge. Andernfalls wird die veraltete Empfehlung abgelehnt.
10. Projizierte Überholungen bleiben Ergebnisdiagnostik. Ausschließlich bei `CALL_NEXT` atomar
   bestätigte Überholungen fließen als historische Fairnessschuld in spätere Planungen ein.

## Begrenzung und Laufzeit

Die Standardgrenzen sind 36 Gruppen je Ressourcengruppe, 18 je Produkt, vier Wellen, 64 Kandidaten
je Schritt und Beam-Breite 24. Der Simulator verwendet für schnelle Mehrfachläufe kleinere, aber
fachlich identische Grenzen. Die Kandidatenerzeugung kombiniert ausschließlich vollständige Gruppen
eines Produkts bis zur Sitzkapazität. Alle Sortierungen enden mit stabilen IDs. Gleiche Eingaben
erzeugen bitgleich denselben Plan; Eingabeobjekte werden nicht verändert.

Eine Batch-ID wird aus Ressourcengruppe, Produkt, Gate und der geordneten Gruppen-/Segmentmenge
gebildet. Lane, Welle, Pilot und angenommenes Flugzeug gehören nicht zur Identität. Ein gleich
großes, früher verfügbares Flugzeug kann deshalb denselben Batch übernehmen, während die geänderte
Bahnnutzung eine neue Planrevision erzeugen darf.

Die Grenzen gelten nur für die nahe Dispatch-Empfehlung. `NOT_IN_NEAR_DISPATCH_BATCH` entfernt keine
Prognose. Der nachgelagerte vollständige Schwanz verarbeitet alle prognostizierbaren Gruppen linear,
übernimmt Flugzeug-/Pilotenspuren und Einschränkungen und läuft bei Bedarf über das Betriebsende
hinaus. Details begründet ADR-0033.

## Persistenz und Kompatibilität

Migration `0060_dispatch_planning_and_gate_travel_lead.sql` ergänzt Gate-Wegvorlauf,
Planmetadaten an Umläufen und Forecast-Snapshots sowie historische Vorabrufkomponenten. Alte
Stammdatenimporte ohne `travelLeadMinutes` bleiben durch den Standardwert `0` gültig. Backup,
Wiederherstellung, Ereigniskopie, Stammdatenvorlage und Simulationsplan transportieren das Feld.

## Operative Invarianten

- Ein Batch ist produktrein, gruppenatomar und kapazitätskonform.
- Ein Ticket bleibt höchstens einem nicht abgeschlossenen Umlauf zugeordnet.
- Eine Empfehlung ist keine dauerhafte Flugzeugbindung; erst `CALL_NEXT` bestätigt sie.
- `COME_TO_FLIGHT_LINE` bindet vor dem Lease keine Gruppe an eine prognostizierte Flugzeugbahn.
- Ein aktiver Lease bindet Gruppenmenge und Flugzeug bis Bestätigung, Freigabe oder Ablauf.
- Bereits aufgerufene Gruppen dürfen ohne unvermeidbaren Ressourcenverlust nicht später eingeplant
  werden; der bisherige prognostizierte Boardingzeitpunkt wird vor Wartezeit-, Durchsatz- und
  Auslastungszielen geschützt.
- Ressourcenverlust darf neu planen, aber keine Gruppe duplizieren oder teilen.
- Fehlende Prognosekapazität erzeugt Grund und leeres Fenster, niemals einen künstlichen Nullwert.
- Alle bestätigten operativen Zustandsänderungen bleiben versioniert, idempotent und auditiert.

## Tests und Betrieb

Die fachliche Matrix A–K liegt in `packages/domain/src/dispatch-plan.test.ts`,
`packages/domain/src/forecast.test.ts`, `packages/domain/src/precall.test.ts` sowie den Worker- und
Simulator-Tests. Der lokale Reset mit Migration und Seed wird über `npm run db:reset:local`
verifiziert. Vollständige Freigabeprüfungen erfolgen mit `npm run check` und
`npm run requirements:verify`.
