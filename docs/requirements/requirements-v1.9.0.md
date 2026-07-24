# Release 1.9.0 – Kassenstatus, POS-58 und operative Ansichtsbezeichnungen

Diese funktionale Ausbaustufe gehört zum Applikationsrelease `1.9.0`. Sie übernimmt Release 1.8.0
und die fortgeltenden Kataloge V1.4 bis V1.8.0. Die folgenden Anforderungen konkretisieren das am
24. Juli 2026 freigegebene Delta für Favicon, Kasse, Flight Director und Flight Line.

| ID | Anforderung | Priorität |
| --- | --- | --- |
| V19-REL-010 | Applikation, Workspace-Pakete, Requirements, Traceability und UI-Konzepte verwenden konsistent Version `1.9.0`. | MUSS |
| V19-BRN-010 | Das generische Anwendungsicon zeigt ausschließlich ein blaues Lucide-Plane-Outline auf dunklem Hintergrund; SVG, Apple-Touch-, reguläre PWA- und Maskable-Rastervarianten bleiben synchron und die ansichtsspezifischen Symbole unverändert. | MUSS |
| V19-CAS-010 | Die Kasse teilt Verkaufsbuttons fest in ein zentriertes Symboldrittel und zwei zentrierte Textdrittel. Die Ticketlisten verwenden die freigegebenen Symbolköpfe, zeigen Personen ohne nachgestelltes Symbol und ergänzen den Abschlussstatus leer, begonnen oder vollständig abgeschlossen. Der Tab `Offene Tickets` liegt zwischen verkauften und stornierten Tickets und verwendet die serverseitige offene Ergebnismenge. | MUSS |
| V19-PRN-010 | Der POS-58-Ausdruck beginnt ohne Vorlauf am oberen Papierrand, verwendet genau eine Druckregelquelle ohne feste Seiten- oder Mindesthöhe und überlässt die Rollenlänge dem Druckertreiber. Ticketinhalt und QR-Code bleiben unverändert. | MUSS |
| V19-RTE-010 | Die bisherige Supervisor-Oberfläche heißt `Flight Director`, behält ihr Symbol und ist ausschließlich unter `/flight-director` registriert. Die bisherige Assist-Oberfläche heißt `Flight Line`, behält ihr Symbol und ist ausschließlich unter `/flight-line` registriert. `/flight-line/assist` besitzt weder Route noch Installationsprofil oder Legacy-Weiterleitung. | MUSS |
| V19-API-010 | Die operative Ticketsuche akzeptiert zusätzlich `status=OPEN` und filtert vor Suche, Cursorbildung und Pagination alle nicht stornierten, noch nicht vollständig abgeschlossenen Buchungsgruppen. Es entstehen keine neuen Domänenzustände oder Datenbankfelder. | MUSS |
| V19-QA-010 | Unit-, Contract-, Worker-, UI-, Routing-, PWA-, Druck- und Browserabnahmen decken Splitgruppen, alle Abschlussanzeigen, Tabreihenfolge, Pagination, neue Pfade, entfernten Legacy-Pfad, kleine Favicon-Größen sowie Desktop-, Tablet-, Hell- und Dunkeldarstellung ab. | MUSS |

## Freigegebene UI-Referenz

Das am 24. Juli 2026 im Auftraggeberdialog freigegebene Gesamtkonzept ist in
`docs/ui/v1.9.0-cashier-concept.md` und
`docs/ui/v1.9.0-flight-director-flight-line-concept.md` textuell festgehalten. Es werden keine
weiteren Layout- oder Ablaufänderungen abgeleitet.
