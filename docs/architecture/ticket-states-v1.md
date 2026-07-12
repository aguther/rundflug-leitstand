# Ticketzustände V1

Ticketzustände werden aus bestätigten Kommandos atomar mit Umlauf, Audit-Ereignis,
Idempotenzbeleg und Outbox fortgeschrieben. Öffentliche Ansichten bilden daraus nur die wenigen
handlungsorientierten Gastzustände ab.

| Fachlicher Zustand | Technische Repräsentation |
| --- | --- |
| Verkauft | append-only `TICKET_GROUP_SOLD`; anschließend operative Einreihung als `QUEUED` |
| Wartend | `tickets.status = QUEUED` |
| Voraufruf | aus `QUEUED`, Prognosefenster und Benachrichtigungsvorlauf abgeleitet; öffentlich `PREPARE` |
| Bitte zur Flight Line | `CALLED` nach `CALL_NEXT` |
| Eingecheckt | `CHECKED_IN` bei Anwesenheitsbestätigung vor Aufruf |
| Boarding | `BOARDING`, wenn ein eingechecktes Ticket aufgerufen ist |
| Im Flug | `IN_FLIGHT` |
| Gelandet | `LANDED`; Flugzeug bleibt belegt |
| Abgeschlossen | `COMPLETED`; erst jetzt wird das Flugzeug verfügbar |
| Zurückgestellt | append-only `TICKET_GROUP_DEFERRED` mit Zähler; unterhalb der Grenze erneute Einreihung als `QUEUED` |
| No-Show | `NO_SHOW` und Audit-Ereignis |
| Klärung Kasse | `CLARIFICATION` nach Erreichen von `maxTicketDeferrals`; keine operative Rotation |
| Storniert | `CANCELED` und Audit-Ereignis |

Check-in, Aufruf und Rücknahme halten Anwesenheits- und Ticketstatus zusammen. `REVOKE_CALL` und
`ABORT_ROTATION` setzen Tickets abhängig von bestätigter Anwesenheit auf `CHECKED_IN` oder `QUEUED`
zurück. Ab `IN_FLIGHT` sind Anwesenheit und Besetzung gesperrt.

Der Integrationslauf `npm run test:vertical-slice` prüft die normale Folge einschließlich Aufruf-
Rücknahme. `npm run test:ticket-deferrals` prüft Zähler, Wiedereinreihung, Klärung Kasse,
Kassensuche und Auditierung.
