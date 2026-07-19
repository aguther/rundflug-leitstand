# Verifikation operative Historie V1

Die geschützte Abfrage `GET /api/control/:eventId/history/operations` stellt die dauerhafte
operative Historie für Flüge, Fluggruppen und anonyme Tickets bereit. Sie unterstützt die Filter
aus F-HIS-010:

- Zeitraum,
- Flugzeug und Pilotencode,
- Produkt und Ressourcengruppe,
- Fluggruppen-/Slotnummer,
- Ticket und Ticketgruppe,
- Ticket- und Umlaufstatus sowie
- Gate und Umlauf als zusätzliche operative Bezüge.

Die Antwort ist mit `limit` und `offset` paginiert und enthält eine Gesamtzahl. Auch gelöste
Ticket-Umlauf-Zuordnungen bleiben sichtbar, damit Storno und Umbuchung die Historie nicht
überschreiben. Filterwerte werden ausschließlich als gebundene D1-Parameter verarbeitet.

Zugriff erhalten Administration, Flight-Line-Leitung und Flugleitung. Kassen-Geräte werden mit
`403` abgewiesen. Umgekehrte Zeiträume, unbekannte Statuswerte und andere ungültige Filter werden
mit `400` abgewiesen.

`npm run test:ticket-corrections` verifiziert mit synthetischen Daten:

- Storno und Umbuchung einschließlich freigegebener historischer Zuordnungen,
- Filterung nach Produkt, Ressourcengruppe, Fluggruppe, Status und Ticketgruppe,
- Pagination und Gesamtzahl,
- Rollenprüfung und Zeitbereichsvalidierung sowie
- Auditierung, Idempotenz und Ablehnung veralteter Schreibversuche des zugrunde liegenden Ablaufs.

Ergänzend prüfen Vertrags- und SQL-Unit-Tests das anonyme Antwortformat, alle Filterbindungen und
dass auch bösartige Eingaben nie in den SQL-Text gelangen.
