# Release 1.8.0 – Busy Indicator, absolute Zeitfenster und Gruppenticket

Diese funktionale Ausbaustufe gehört zum Applikationsrelease `1.8.0`. Sie übernimmt Release 1.7.3
und die fortgeltenden Kataloge V1.4 bis V1.7.3. Die folgenden Anforderungen konkretisieren die
freigegebenen Delta-Konzepte für Kasse, Flight Line, FIDS und öffentlichen Gruppenstatus.

| ID | Anforderung | Priorität |
| --- | --- | --- |
| V18-REL-010 | Applikation, Workspace-Pakete, Requirements, Traceability und UI-Konzepte verwenden konsistent Version `1.8.0`. | MUSS |
| V18-BSY-010 | Jede durch einen Button ausgelöste asynchrone Aktion ersetzt ausschließlich in diesem Button Icon und Text durch den gemeinsamen Busy Indicator, setzt `aria-busy`, behält die intrinsische Breite und zeigt bei reduzierter Bewegung einen statischen Zustand. Andere gleichzeitig gesperrte Buttons behalten ihren Inhalt. Rein lokale Navigation und Auswahl zeigen keinen Busy Indicator. | MUSS |
| V18-TIM-010 | Prognostizierte Zeitfenster werden in der Veranstaltungszeitzone absolut dargestellt: regulär `ca. 14:20 – 14:40 Uhr`, in kompakten Tabellen `14:20 – 14:40`, bei unmittelbarem Aufruf `Jetzt`, nach Abflug `–` und bei unsicherer Prognose regulär `Wird aktualisiert`, kompakt `–`. Bei Datumswechsel werden Datum und Uhrzeit genannt. Die Anzeige bleibt eine Prognose. | MUSS |
| V18-CAS-010 | Die obere Kassenliste entfernt ausschließlich Fluggruppe und Status. Der Detailbereich entfernt die linke Gruppen-Infobox und zeigt je operativer Fluggruppe F Fluggruppe, Personen, Phasensymbol, `GoToGate-Aktiv` mit `circle-arrow-right` und Check nur bei `DRAFT` plus Voraufruf sowie das absolute Zeitfenster. Der Druckbutton heißt in jedem Zustand exakt `Ticket drucken`; ein Druck startet nur nach Betätigung. | MUSS |
| V18-FLT-010 | Die Flight-Line-Liste verwendet exakt `Ticketgruppe, Fluggruppe, Queue, Personen, Status, Flugzeug, Produkt, GoToGate-Aktiv, Zeitfenster, Boarding, Off-Block, On-Block, Abschluss`. Ticketgruppe zeigt G, Fluggruppe separat F mit `tag`, Produkt `package`, Status nur als Phasensymbol und GoToGate-Aktiv `circle-arrow-right` mit Check oder leer. Fluggruppe und GoToGate-Aktiv sind sortierbar; Suche, Filter, Scrollverhalten und übrige Spalten bleiben erhalten. | MUSS |
| V18-GRP-010 | Jede öffentliche Buchungsgruppe G besitzt genau einen stabilen öffentlichen Gruppencode, QR-Code und gemeinsamen Ticketzettel. Interne Personentickets bleiben Berechtigungsobjekte, ihre Codes werden weder angezeigt noch gedruckt. Die öffentliche Gruppenseite aggregiert alle aktuellen Teilflüge und zeigt bei Aufteilung Teilflugnummer, Personenzahl, öffentlichen Status, Gate und Zeitfenster ohne interne F-Kennung. | MUSS |
| V18-API-010 | Betriebs-, FIDS-, Ticket- und Gruppenverträge liefern explizite ISO-Grenzen des prognostizierten Boarding-Fensters und die Veranstaltungszeitzone; kompatible Minutenfelder bleiben vorerst erhalten. Neue Gruppen sind über `/gruppe/:code` und `/api/public/groups/:groupCode` erreichbar; alte `/ticket/:code`-Links bleiben funktionsfähig. | MUSS |
| V18-DAT-010 | Migration 0042 ergänzt den gehashten und geschützt gespeicherten öffentlichen Gruppencode sowie gruppenbezogene Push-Abonnements. Bestandsgruppen übernehmen deterministisch den ältesten Ticketcode. Gruppen-Push reagiert auf jeden aktuellen Teilflug. Codes erscheinen nicht in Logs, Audit-Payloads oder Outbox. | MUSS |
| V18-OPS-010 | Der Wechsel vom Personen- zum Gruppencode, die Rückwärtskompatibilität und die Wiederherstellung per D1 Time Travel beziehungsweise vollständiger Sicherung sind in ADR und Migrationsnotiz dokumentiert. | MUSS |
| V18-QA-010 | Komponenten-, Formatter-, Contract-, Migrations-, API-, Sicherheits- und UI-Tests sowie Browserabnahmen decken Busy-Semantik, exakte Zeitformate, Kassen- und Flight-Line-Spalten, einen Gruppendruckzettel, Split-Gruppenstatus, Push, Legacy-Links und Token-Geheimhaltung ab. | MUSS |

## Freigegebene UI-Referenz

Die am 23. Juli 2026 im Auftraggeberdialog freigegebenen Delta-Konzepte sind in
`docs/ui/v1.8.0-cashier-concept.md`, `docs/ui/v1.8.0-flight-line-concept.md` und
`docs/ui/v1.8.0-group-ticket-concept.md` textuell festgehalten. Es werden keine weiteren
Layoutänderungen abgeleitet.
