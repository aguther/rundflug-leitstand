# Feedback-Ausbaustufe V1.5

Diese freigegebene Ergänzung konkretisiert und überstimmt bei Widersprüchen die durchsuchbare
Fassung V1.4. Die binären V1.4-Referenzen bleiben unverändert.

| ID | Anforderung | Priorität |
| --- | --- | --- |
| V15-AUTH-010 | Interne Sitzungen gelten 16 Stunden absolut ohne Idle-Ablauf; Abmeldung, Deaktivierung und Widerruf wirken sofort. | MUSS |
| V15-NAV-010 | Jede interne Rolle kann jederzeit über denselben Ansichtswechsler navigieren; nicht berechtigte Ziele bleiben an derselben Stelle gesperrt sichtbar. | MUSS |
| V15-ROLE-010 | Flugleitung und bisherige Betriebsleitung werden als `FLIGHT_DIRECTOR` zusammengeführt. | MUSS |
| V15-QUE-010 | Jede verkaufte Buchungsgruppe bleibt mit stabiler Kommunikationsnummer einzeln sichtbar und wird nicht automatisch mit kleinen Verkäufen verschmolzen. | MUSS |
| V15-QUE-020 | Ein Aufruf kombiniert ausschließlich ausdrücklich ausgewählte, vollständige und kompatible Gruppen atomar innerhalb der Flugzeugkapazität. | MUSS |
| V15-FLT-010 | Die internen Ist-Ereignisse heißen `MARK_OFF_BLOCK` und `MARK_ON_BLOCK`; der Turnaround endet separat mit einem expliziten Flugzeug-Folgezustand. | MUSS |
| V15-FLT-020 | Flight Line darf Anwesenheit gruppen- oder ticketweise ohne Kamerascan pflegen sowie „Nicht da“ und „Nachrufen“ getrennt auditieren. | MUSS |
| V15-TKT-010 | Ticketcodes werden bis zur Löschung ihrer Veranstaltung im Klartext geschützt gespeichert und bleiben zusätzlich über ihren Hash öffentlich auflösbar. | MUSS |
| V15-TKT-020 | Die Kasse kann jeden Verkauf erneut als einfachen Ticketzettel mit großem QR-Code anzeigen oder drucken; der Zettel enthält keine Bon-, Steuer-, Zahlungs- oder Summendarstellung. | MUSS |
| V15-FIDS-010 | Das öffentliche FIDS benötigt keine Gerätekopplung; eine nicht erratene Veranstaltungs-URL genügt. | MUSS |
| V15-FIDS-020 | Abgeflogene FIDS-Zeilen werden nach einer veranstaltungsbezogenen Frist von 5 bis 900 Sekunden ausgeblendet; Standard sind 15 Sekunden. | MUSS |
| V15-BRAND-010 | Ein Veranstaltungslogo darf als PNG, JPEG, WebP oder sicheres SVG bis 1 MiB hinterlegt werden; ohne Logo oder bei Ladefehler erscheint ein Flugzeugsymbol. | MUSS |
| V15-EVT-010 | Veranstaltungen werden nicht archiviert, sondern können nach ausdrücklicher Bestätigung vollständig gelöscht werden. | MUSS |
| V15-EVT-020 | Wird die letzte Veranstaltung gelöscht, kehrt das System in die Ersteinrichtung zurück. | MUSS |
| V15-EXP-010 | Vor der Löschung kann ein anonymes Leistungsprofil mit Flugplatz, Datum, Flottenkontext, Umlaufzahlen und gemessenen Prozesszeiten exportiert werden. | MUSS |
| V15-UI-010 | Die in `docs/ui/v1.5-concepts.md` gelisteten Chat-Konzepte sind die verbindliche visuelle Spezifikation. | MUSS |
| V15-UI-020 | Kasse und Flight Line bleiben Ein-Bildschirm-Abläufe; Flight Line Assist besitzt eigenständige iPad- und iPhone-Layouts. | MUSS |
| V15-IOS-010 | iPhone und iPad werden zusätzlich zur automatisierten responsiven Prüfung anhand einer manuellen Safari/PWA-Prüfliste abgenommen. | MUSS |
| V15-OPS-010 | Für jede interne Rolle existiert eine kurze Einweisung; eine synthetische Testveranstaltung lässt sich einfach anlegen und wieder löschen. | MUSS |
| V15-ARCH-010 | Bis zum Produktivbetrieb ist ein frischer Datenstand die bevorzugte Update-Strategie; komplexe Rückwärtsmigrationen werden nur bei ausdrücklichem Bedarf ergänzt. | MUSS |

## Flugzustände

Ein Umlauf verwendet `DRAFT`, `CALLED`, `IN_FLIGHT`, `LANDED`, `COMPLETED` und `CANCELED`.
`CALLED` bedeutet, dass die Belegung bestätigt und das Boarding begonnen wurde. Ticket- und
öffentliche Status dürfen daraus ausdrücklich `BOARDING` ableiten. `LANDED` stellt das Flugzeug
nicht automatisch wieder bereit; erst `COMPLETE_TURNAROUND` setzt `AVAILABLE`, `REFUELING`,
`PAUSED` oder `INACTIVE`.
