# Fachmodell, Zustandsautomaten und Prognose V1

Dieses Dokument erfüllt `Q-WAR-050` und beschreibt den tatsächlich implementierten Stand der V1.
Es richtet sich an Betreiber, die das Verhalten im Veranstaltungstag verstehen müssen, und an
Entwickler, die Fachlogik ändern oder erweitern. Maßgeblich bleiben die Anforderungen V1.4, die
freigegebenen ADRs und die automatisierten Tests.

## 1. Fachliche Leitplanken

Der Leitstand koordiniert Nachfrage und den beobachteten Betriebsablauf. Er trifft keine
flugbetriebliche, sicherheitsrelevante oder luftrechtliche Entscheidung. Gewichts-, Kraftstoff- und
Kapazitätshinweise sind organisatorische Hinweise ohne Freigabewirkung.

Die operative Wahrheit entsteht ausschließlich aus bestätigten Kommandos. Browserzustand,
Prognosewerte und WebSocket-Signale sind keine eigenständige Source of Truth. D1 enthält den
materialisierten Zustand, das unveränderliche Ereignisprotokoll, Idempotenzbelege und die Outbox.
Das Durable Object einer Veranstaltung serialisiert alle Schreibkommandos.

## 2. Kommando- und Konsistenzmodell

Jedes Schreibkommando enthält mindestens `commandId`, `eventId`, `deviceId`, `expectedVersion`,
`issuedAt`, einen typisierten Kommandonamen und dessen Nutzdaten. Die Verarbeitung folgt dieser
Reihenfolge:

1. Transportvertrag aus `packages/contracts/src/index.ts` validieren.
2. Bereits vorhandenen Idempotenzbeleg für `commandId` zurückgeben.
3. aktive Gerätekopplung und Geräte-Token prüfen.
4. Rolle mit `assertRoleMayExecute` aus `packages/domain/src/index.ts` prüfen.
5. aktuelle Veranstaltungsversion mit `expectedVersion` vergleichen.
6. Fachinvarianten und Zustandsübergang prüfen.
7. Zustand, `operational_events`, `idempotency_receipts` und `outbox` gemeinsam per D1-Batch
   persistieren.
8. erst nach erfolgreicher Persistenz das Versionssignal veröffentlichen.

Eine wiederholte `commandId` liefert denselben gespeicherten Erfolg mit `duplicate: true`. Eine
abweichende aktuelle Version liefert `STALE_VERSION` und wird niemals still überschrieben. Ein
abgewiesenes Kommando verändert weder Fachzustand noch Ereignisprotokoll.

Die Implementierung liegt in `apps/worker/src/event-coordinator.ts`; der Transport und die
reduzierten öffentlichen DTOs liegen außerhalb der reinen Domänenlogik.

## 3. Zustandsautomaten

### 3.1 Veranstaltung

| Aktueller Zustand | Zulässiger Folgezustand | Zusätzliche Bedingung |
| --- | --- | --- |
| `PREPARATION` | `ACTIVE` | Betriebsende sowie mindestens ein Produkt, aktives Gate, aktive Ressourcengruppe, zugeordnetes Flugzeug und aktiver Pilot |
| `ACTIVE` | `CLOSED` | keine offenen oder laufenden Umläufe |
| `CLOSED` | `ACTIVE` | dieselbe Bereitschaftsprüfung wie beim Erststart |
| `CLOSED` | `ARCHIVED` | keine offenen oder laufenden Umläufe |
| `ARCHIVED` | – | terminal |

Aktivierung, Schließen, Reaktivierung und Archivierung benötigen Administratorrolle, PIN und
Begründung. Notfallmodus und organisatorische Unterbrechung sind davon getrennte Zustände. Sie
beenden oder überschreiben die Veranstaltungshistorie nicht.

### 3.2 Umlauf und gekoppelter Flugzeugzustand

| Kommando | Umlauf vorher → nachher | Flugzeug nach Bestätigung | Gespeicherte Ist-Zeit |
| --- | --- | --- | --- |
| `CALL_NEXT` | `DRAFT` → `CALLED` | `BOARDING` | `called_at` |
| `MARK_IN_FLIGHT` | `CALLED` → `IN_FLIGHT` | `IN_FLIGHT` | `departed_at` |
| `MARK_LANDED` | `IN_FLIGHT` → `LANDED` | `LANDED` | `landed_at` |
| `MARK_COMPLETED` | `LANDED` → `COMPLETED` | `AVAILABLE` | `completed_at` |
| `REVOKE_CALL` | `CALLED` → `DRAFT` | wieder verfügbar | dokumentiertes Rücknahmeereignis |

`GELANDET` macht ein Flugzeug ausdrücklich nicht verfügbar. Erst `MARK_COMPLETED` bestätigt den
Abschluss von Ausstieg und Bodenprozess. Ab `IN_FLIGHT` sind Besetzung, Anwesenheit und normale
Queue-Korrekturen gesperrt. Ein Pilot darf nicht gleichzeitig in mehreren aktiven Umläufen stehen.
Jeder Umlauf hält das beim Anlegen wirksame Gate historisch fest. Eine rein organisatorische,
anonyme Bemerkung kann über `SET_ROTATION_NOTE` geändert werden; Änderung und Begründung werden
auditiert.

Die reine Übergangsprüfung erfolgt durch `transitionRotation` in `packages/domain/src/index.ts`.
Flugzeug-, Pilot-, Ticket- und Umlaufzustand werden im Worker in derselben D1-Batchgrenze
fortgeschrieben.

### 3.3 Organisatorischer Flugzeugzustand

Außerhalb eines aktiven Umlaufs kann ein verfügbares Flugzeug auf `REFUELING`, `PAUSED` oder
`INACTIVE` gesetzt werden. Eine gemeldete Unterbrechung wird als `INACTIVE` plus
`operational_interrupted` und aktivem Betriebsblock gespeichert. Rückkehr auf `AVAILABLE` hebt den
Block auf. Während `BOARDING`, `IN_FLIGHT` oder `LANDED` darf die Flottenverwaltung den
Umlaufzustand nicht umgehen.

Eine Pause kann ohne Endzeit oder mit einer unverbindlichen erwarteten Dauer erfasst werden. Ohne
Endzeit bleibt die Ressource aus der vorausberechneten Kapazität entfernt. Mit Endzeit darf die
Prognose die spätere Rückkehr einplanen; verfügbar wird das Flugzeug oder der Pilotencode trotzdem
erst durch eine menschlich bestätigte Statusänderung. Das Überschreiten der erwarteten Endzeit löst
keine automatische Freigabe aus.

`SCHEDULE_AIRCRAFT_REFUEL` ist nur eine Vormerkung. `REFUELING` nimmt das Flugzeug tatsächlich aus
der Disposition. Der Umlaufzähler wird erst beim bestätigten Abschluss erhöht und beim Übergang
`REFUELING` → `AVAILABLE` zurückgesetzt.

### 3.4 Ressourcengruppe

Ressourcengruppen besitzen `ACTIVE`, `PAUSED`, `INTERRUPTED` und `ENDED`. Nur `ACTIVE` erlaubt neue
Verkäufe und Aufrufe. Pausen und Unterbrechungen erzeugen einen nachvollziehbaren Betriebsblock;
die Rückkehr auf `ACTIVE` schließt aktive Blöcke. Nicht betroffene Ressourcengruppen laufen weiter.

### 3.5 Tickets und Buchungsgruppen

Die ausführliche Zuordnung steht in `docs/architecture/ticket-states-v1.md`. Wesentliche Regeln:

- gemeinsam verkaufte Tickets bilden eine unteilbare Buchungsgruppe;
- `CHECKED_IN` ist ein Anwesenheitsstatus und ersetzt nicht den Umlaufstatus;
- `CALLED`, `IN_FLIGHT`, `LANDED` und `COMPLETED` folgen dem bestätigten Umlauf;
- Rückstellung reiht die vollständige Gruppe erneut ein oder führt nach der konfigurierten Grenze
  zu `CLARIFICATION`;
- Storno, Rückstellung und No-Show sind ab `IN_FLIGHT` unzulässig; neue Umbuchungen existieren nicht,
  Korrekturen erfolgen durch Storno und Neuverkauf;
- Korrekturen erzeugen neue Ereignisse; bestehende Audit-Einträge werden nicht verändert.

### 3.6 Papier-Nacherfassung

Ein Nacherfassungsbatch durchläuft `STAGED` beziehungsweise `CONFLICTED`, danach im
Vier-Augen-Prinzip `APPROVED` und schließlich `APPLIED`. Simulation und Anwendung prüfen erneut die
Veranstaltungsversion. Doppelte Belegfolgen, Ticketcodes, zukünftige Zeitpunkte, fehlende Referenzen
und ungültige Umlaufübergänge blockieren den gesamten Batch.

## 4. Nicht verhandelbare Invarianten und technische Sicherungen

| Invariante | Primäre Sicherung |
| --- | --- |
| Produkt verwendet genau eine Ressourcengruppe | nicht nullable Fremdschlüssel `products.resource_group_id` plus Vertragsprüfung |
| Flugzeug höchstens in einer aktiven Ressourcengruppe | partieller Unique-Index `uq_aircraft_one_active_resource_group` plus `assertSingleActiveResourceGroup` |
| eine operative Queue je Ressourcengruppe | Queue-Sequenz der Buchungsgruppen innerhalb der Ressourcengruppe; Planung über ganze Gruppen |
| stabile Kommunikationsnummer | Unique-Constraint aus Veranstaltung, Ressourcengruppe und `communication_number` |
| Ticket höchstens in einem nicht freigegebenen Umlauf | partieller Unique-Index `uq_ticket_one_active_rotation` |
| Gruppen werden nicht automatisch getrennt | `assertGroupIsNotAutomaticallySplit` und ganzzahlige Gruppenobjekte in `planNextRotations` |
| nach `NEXT` keine stille Umbesetzung | konkrete Flugzeug- und Pilotenzuordnung entsteht erst in `CALL_NEXT`; Prognoseneuberechnung ändert sie nicht |
| `LANDED` ist nicht `AVAILABLE` | getrennte Umlaufkommandos `MARK_LANDED` und `MARK_COMPLETED` |
| jede Zustandsänderung ist auditiert | gemeinsamer D1-Batch mit `operational_events` |
| Audit und Prognose-Snapshots sind append-only | D1-Trigger verbieten `UPDATE` und `DELETE` |
| Doppel-Tipp bleibt einfach | eindeutiger Idempotenzbeleg je `commandId` |
| stale writes werden abgelehnt | erwartete Veranstaltungsversion und zusätzliche Aggregatversionen |
| keine Gastnamen oder Telefonnummern | anonyme Verträge und Schema; öffentliches Ticket wird nur als SHA-256-Hash gespeichert |
| öffentliche Codes nicht aufzählbar | zufällige 12–32-stellige Codes, Hash-Lookup, neutrale Fehlerantwort und Rate Limit |
| keine Sicherheitsfreigabe | neutrale UI-/Vertragssprache; Kapazität und Gewicht bleiben organisatorische Hinweise |

Die Datenbanksicherungen stehen in `apps/worker/migrations/`; fachliche Prüfungen in
`packages/domain/src/`; die atomare Orchestrierung in `apps/worker/src/event-coordinator.ts`.

## 5. Prognoseverfahren

### 5.1 Zeitarten

- **Planzeit:** beim ersten Rechenlauf aus Erstellzeit, Queueposition und konfigurierten
  Referenzdauern abgeleitet; wird anschließend nicht überschrieben.
- **Prognosezeit:** bei relevanten bestätigten Ereignissen neu berechnete Erwartung.
- **Ist-Zeit:** ausschließlich durch bestätigte operative Kommandos erfasst.

Alle Zeitpunkte werden als UTC gespeichert. Eingabe und Anzeige verwenden die IANA-Zeitzone der
Veranstaltung, standardmäßig `Europe/Berlin`. Nicht existierende oder mehrdeutige lokale
Sommerzeitpunkte werden vor dem Kommando abgewiesen.

### 5.2 Eingangsgrößen

Der Rechenlauf verwendet:

- Queueposition der noch offenen Umläufe;
- Produkt-Referenzflugdauer;
- geplante Boarding-, Deboarding- und Pufferdauer der Veranstaltung;
- aktive, nicht pausierte, nicht tankende und nicht unterbrochene Flugzeuge je Ressourcengruppe;
- Anzahl aktiver, nicht pausierter Piloten; die nutzbare Parallelität ist das Minimum aus Flugzeugen
  und Piloten;
- Zustand von Veranstaltung und Ressourcengruppe;
- gespeicherte Ist-Zeiten laufender Umläufe;
- bis zu zwölf jüngste abgeschlossene Vergleichsumläufe, bevorzugt für Produkt und Flugzeugtyp,
  sonst für das Produkt.
- optionale erwartete Endzeiten aktiver Flugzeug- und Pilotencode-Pausen; Pausen ohne Endzeit
  reduzieren die vorhergesagte Kapazität bis zur bestätigten Rückkehr.

### 5.3 Lernen aus Ist-Daten

Nur `COMPLETED`-Umläufe mit `called_at` und `completed_at` liefern Messwerte. Der Referenzwert erhält
Gewicht 1; reale Werte erhalten in zeitlicher Folge Gewichte ab 2, sodass jüngere Messungen stärker
wirken. Nicht endliche, nicht positive oder mehr als dreifach über dem Referenzwert liegende Werte
werden entfernt. Ab fünf plausiblen Werten begrenzt Median Absolute Deviation weitere Ausreißer.

Details und Begründung stehen in `docs/architecture/forecast-sample-policy-v1.md`; die reine Logik
liegt in `packages/domain/src/forecast.ts`.

### 5.4 Qualitätsstufen und Intervalle

| Qualität | Bedeutung | Öffentliche Wirkung |
| --- | --- | --- |
| `STABLE` | mindestens fünf robuste Werte und mittlere absolute Abweichung höchstens fünf Minuten | engeres Intervall möglich |
| `CHANGING` | Kaltstart oder noch schwankende Messwerte | breiteres Zeitfenster |
| `UNCERTAIN` | Unterbrechung, Notfall, inaktive Ressourcengruppe, keine aktive Kapazität oder veraltete Tagesmessung | kein scheinpräziser Countdown |

Bei `STABLE` verwendet die Dauerschätzung ±5 Minuten, sonst ±10 Minuten. Das Queuefenster wird mit
der Zahl paralleler Ressourcen und den vollständigen Zyklen vor der Gruppe verbreitert. Ist ein
erwartetes Ereignis überfällig, verschiebt `advanceOverduePrediction` alle davon abhängigen
Zeitpunkte nach vorn, statt einen bereits vergangenen Zeitpunkt weiter anzuzeigen.

### 5.5 Kapazität

`assessRemainingCapacity` in `packages/domain/src/capacity.ts` berechnet zunächst die verbleibenden
vollständigen Umläufe und die Summe der aktiven Sitzplätze. Unsicherheit reduziert die rechnerische
Kapazität konservativ: Faktor 1,0 bei `STABLE`, 0,85 bei `CHANGING`, 0,6 bei `UNCERTAIN`.
Reservierte und bereits offene Plätze werden abgezogen. Die Schwellwerte ergeben `AVAILABLE`,
`LIMITED`, `MANUAL_REVIEW` oder `SOLD_OUT`; sie sind keine flugbetriebliche Freigabe.

### 5.6 Ausführung, Snapshots und Fehlerverhalten

Nach einer erfolgreichen Fachtransaktion stößt das Durable Object die Prognose asynchron an. Der
Rechenlauf verändert keine bestätigten Ist-Ereignisse. Er aktualisiert die Prognosefelder offener
Umläufe, fügt pro Umlauf einen unveränderlichen Snapshot hinzu, prüft Vorabbenachrichtigungen und
sendet danach `forecast-updated`.

Scheitert die Prognose, bleibt der bestätigte operative Zustand gültig; der Fehler wird mit
`FORECAST_RECALCULATION_FAILED` ohne Tickets, PIN oder Secrets protokolliert. Der nächste bestätigte
Zustandswechsel startet einen neuen Lauf. Snapshots und Wiederherstellung sind in
`docs/architecture/forecast-snapshots-v1.md` beschrieben.

### 5.7 Automatischer Voraufruf und menschliche Bestätigung

Der Prognoselauf kann eine noch ungebundene Fluggruppe automatisch auf `GO_TO_GATE` setzen. Dafür
müssen Queueposition, Prognosequalität, verfügbare Ressourcenkapazität und die konfigurierte
akzeptable Wartezeit am Gate zusammenpassen. Der Voraufruf bindet weder Flugzeug noch Pilotencode und
ist reversibel, solange noch kein `NEXT` bestätigt wurde.

`NEXT` bleibt eine bewusste Aktion der Flight Line. Erst diese Bestätigung wählt ein konkret
passendes Flugzeug, bindet die Gruppe und startet Boarding. Gruppen werden beim Voraufruf und bei
`NEXT` nie automatisch getrennt. Die Standardanzeige übersetzt den Voraufruf als „Bitte zum Gate“,
das Terminalprofil ausschließlich als `GO TO GATE`.

## 6. Betreiberleitfaden

### Normaler Ablauf

1. Veranstaltung in `PREPARATION` vollständig einrichten.
2. Bereitschaft aus Betriebsende, Gate, Ressourcengruppe, Flugzeugzuordnung, Produkt und Pilot
   prüfen und Veranstaltung aktivieren.
3. Kasse verkauft nur bei aktiver, ausreichend sicherer Betriebs- und Kapazitätslage.
4. Flight Line bestätigt ausschließlich beobachtete Ereignisse in der Reihenfolge `NEXT`,
   `IM FLUG`, `GELANDET`, `ABGESCHLOSSEN`.
5. Pausen, Tanken und Unterbrechungen als Zustand erfassen; keine Prognosezeiten manuell
   überschreiben.

### Wenn die Prognose unsicher ist

- prüfen, ob Veranstaltung, Ressourcengruppe oder Flugzeug unterbrochen beziehungsweise pausiert ist;
- prüfen, ob ein Umlauf auf ein reales Ereignis wartet;
- den tatsächlichen Zustand erfassen oder die Blockierung bewusst aufheben;
- keine künstlichen Ist-Zeiten erzeugen, nur um die Prognose zu verändern;
- bei Verbindungswarnung keine operative Wirkung annehmen, bis ein bestätigter Stand vorliegt.

### Bei Konflikten

- `STALE_VERSION`: aktuellen Stand laden, Situation neu beurteilen und als neues Kommando senden;
- Zustandsfehler: fehlendes reales Vorereignis prüfen;
- Kapazitäts-/Zuordnungsfehler: Gruppe nicht automatisch teilen, sondern menschlich entscheiden;
- `ADMIN_PIN_INVALID` oder Rollenfehler: keine Umgehung; korrekt gekoppeltes Gerät verwenden;
- Fehler anhand Audit-Historie und Gerätekennung nachvollziehen, nicht über direkte D1-Änderungen
  korrigieren.

## 7. Entwicklerleitfaden und Nachweise

Fachregeln gehören nach `packages/domain/src/` und dürfen weder Worker-, HTTP-, UI- noch
Datenbankabhängigkeiten erhalten. Transportformen gehören nach `packages/contracts/src/`. Der Worker
orchestriert Persistenz und Adapter, darf die Domänenregel aber nicht als abweichende zweite Wahrheit
implementieren.

| Thema | Implementierung | Primäre Tests/Nachweise |
| --- | --- | --- |
| Rollen, Verkaufsschutz, Zustände, Gruppenschutz | `packages/domain/src/index.ts` | `packages/domain/src/index.test.ts` |
| Queue und ganze Gruppen | `packages/domain/src/queue.ts` | `packages/domain/src/queue.test.ts`, `scripts/verify_queue_grouping.mjs` |
| Prognose und Überfälligkeit | `packages/domain/src/forecast.ts` | `packages/domain/src/forecast.test.ts`, `apps/worker/src/forecast-sample-coverage.test.ts` |
| konservative Kapazität | `packages/domain/src/capacity.ts` | `packages/domain/src/capacity.test.ts`, `scripts/verify_sale_guards.mjs` |
| Papier-Nacherfassung | `packages/domain/src/outage-recovery.ts` | `packages/domain/src/outage-recovery.test.ts`, `scripts/verify_outage_recovery.mjs` |
| atomare Kommandos und Realtime | `apps/worker/src/event-coordinator.ts` | `scripts/verify_vertical_slice.mjs`, `docs/verification/command-pipeline-v1.md` |
| append-only Audit | D1-Migrationen und Worker | `apps/worker/src/audit-coverage.test.ts` |
| Prognose-Snapshots | Migration `0018_forecast_timelines.sql` | `apps/worker/src/forecast-snapshot-coverage.test.ts` |
| Wiederherstellung | R2-Backupadapter | `scripts/verify_backup_restore.py` |

Vor einer Änderung an einem Automaten oder einer Invariante sind mindestens Vertrag, Domänentest,
Integrationspfad, Audit-Ereignis, Idempotenz, stale-write-Verhalten, Realtime-Auswirkung und
Wiederherstellbarkeit zu prüfen. Der vollständige Nachweis läuft mit `npm run check`.
