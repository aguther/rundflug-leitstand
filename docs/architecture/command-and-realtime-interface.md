# Interne Kommando- und Echtzeitschnittstelle

V1 trennt Schreiben, bestätigte Statusabfrage und Änderungssignal:

- `POST /api/events/:eventId/commands` nimmt ausschließlich typisierte Kommando-Umschläge aus
  `packages/contracts` an. Gerätekennung, Geräte-Token, Rolle, Kommando-ID und erwartete
  Veranstaltungsversion werden vor der Fachlogik geprüft.
- `GET /api/events/:eventId/operations` liefert gekoppelten operativen Geräten den bestätigten
  materialisierten Zustand. Öffentliche Ticket- und Monitorstatus verwenden eigene, reduzierte DTOs.
- `/api/public/events/:eventId/live` veröffentlicht über WebSocket ausschließlich den Hinweis, dass
  eine bestätigte Veranstaltungsversion vorliegt. Der Client lädt daraufhin seinen berechtigten DTO
  neu; das Signal enthält weder Ticketcodes noch interne Aggregate oder Gerätedaten.

Das veranstaltungsbezogene Durable Object serialisiert Schreibkommandos. Persistierter Zustand,
operatives Ereignis, Idempotenzbeleg und Outbox-Eintrag werden in derselben D1-Batchgrenze geschrieben;
erst danach wird das Versionssignal gesendet. Ein wiederholtes Kommando liefert den gespeicherten
Beleg, ein veraltetes Kommando wird mit Konflikt abgelehnt.

Weitere Datenquellen integrieren sich über neue Adapter, die denselben Kommandovertrag verwenden.
Sie dürfen weder direkt Tabellen ändern noch Domänenregeln in Transportcode duplizieren.

Operative Clients verbinden sich automatisch neu, beginnend bei einer Sekunde bis höchstens 15
Sekunden. Ein berechtigter Statusabruf alle 15 Sekunden bleibt als Fallback aktiv. Verzögerte
Antworten mit einer älteren Veranstaltungsversion ersetzen niemals einen neueren bestätigten Stand.
