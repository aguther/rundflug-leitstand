# Verifikation: feste FIDS-Seiten, Split, Filter und gemeinsame Simulation

Stand: 2026-08-02
Anforderungen: V173-FID-010, V173-PRI-010, V173-LAY-010, V173-SET-010, V173-AUT-010,
V173-API-010, V173-DAT-010, V173-OPS-010, V173-QA-010

## Automatisierte Abdeckung

| Ebene | Nachweis |
| --- | --- |
| Vertrag | Defaults, strikte Felder, Filtergrenzen und `priorityGroupCount < visibleRows` |
| Domain | feste Seitengrenzen, disjunkte Split-Partition, dringende Erweiterung und Überlauf |
| Worker | Rollen, Migration, erwartete Version, Idempotenz, Audit/Outbox und Public-Kompatibilität |
| React-Controller | URL-Seite, untere Rotation, stabile Priorität, Timerabbau und letzter Offline-Stand |
| Simulation | identische Experience und vollständige synthetische Projektion ohne Live-Schreibpfad |

## Endpunkt- und Datenbankabnahme

Mit ausschließlich synthetischen Daten werden geprüft:

1. DISPLAY und ADMIN erhalten Präferenzen, Filteroptionen und geschütztes Board; andere Rollen werden
   abgewiesen.
2. Zwei identische PUT-Kommandos mit gleichem Idempotenzschlüssel liefern dieselbe gespeicherte
   Version; ein stale write wird abgelehnt.
3. Unbekannte Produkt- oder Gate-IDs werden nicht gespeichert.
4. Die gefilterte Ergebnismenge wird vor `COUNT`, `LIMIT` und `OFFSET` gebildet. Query-Plan und
   Antwortzeit werden gegen den synthetischen Großbestand geprüft.
5. Feste Seiten enthalten höchstens `visibleRows` und stabile `rowId`-Werte. Split-Ober- und
   Unterbereich besitzen keine Schnittmenge.
6. Die anonyme Board-Antwort bleibt am bestehenden Schema parsebar und enthält weder `rowId`,
   `productId`, `gateId` noch Konto- oder Filterdaten.

Der am 2. August 2026 gegen die lokale synthetische D1-Datenbank ausgeführte
`EXPLAIN QUERY PLAN` der vollständigen geschützten Projektion bestätigt:

- Einstieg über `idx_rotations_dispatch_plan (operation_day_id=?)`;
- indexierte Primärschlüsselzugriffe für Fluggruppen, Ressourcengruppen, Tickets, Produkte, Gates
  und Flugzeuge;
- `uq_ticket_group_recalls_active` für aktive Nachrufe;
- `idx_planned_operational_constraints_scope` für öffentliche Betriebshinweise;
- genau eine gemeinsame SQL-Projektion pro Zähl- beziehungsweise Seitenabfrage, keine
  zeilenweisen Worker-Nachladeabfragen.

Nach einem Aufwärmabruf ergaben jeweils 30 lokale HTTP-Messungen am synthetischen QA-Bestand:

| Endpunkt | Mittel | P95 | Maximum | `Server-Timing` letzter Abruf |
| --- | ---: | ---: | ---: | --- |
| öffentliches Board | 15,97 ms | 19,73 ms | 21,54 ms | `public-board;dur=6.0` |
| geschütztes FIDS-Board | 30,93 ms | 34,59 ms | 36,08 ms | `fids-board;dur=20.0` |

Die Messung ist ein lokaler Regressionsnachweis und kein Produktions-SLO.

Die bestehende Public-Monitor-Verifikation blieb einschließlich FIDS-Limit, historischer
Abflugzeilen, Realtime unter zwei Sekunden und 15-Sekunden-Polling grün. Der ergänzende lokale
Skalierungslauf mit 20 verbundenen Geräten, 1.000 Tickets, 300 Umläufen und 6.000 Historieneinträgen
erfüllte sämtliche CI-Guardrails; die Prognose für 300 Umläufe lag bei 501 ms. Dieser Lauf prüft die
repository-weite Skalierungsbasis und ersetzt ebenfalls keine Produktionsmessung.

## Visuelle Abnahme

Die Browserprüfung erfolgt für Live-FIDS und Simulation. Geprüft werden:

- `FIXED_PAGE` und `SPLIT`, jeweils Light und Dark;
- 1920×1080, 1440×900, 800×600 und 640×600;
- Setup-Leiste, Einstellungsdialog, leere Seite und dringender Überlauf;
- ein- und zweispaltiges Layout einschließlich kontrolliertem Rückfall unter 1280 Pixel;
- kein horizontaler Dokument-, Dialog- oder Tabellenscroll und genau ein Dialog-Scrollbereich;
- stabile Kopf-, Tabellen- und Footerpositionen bei Realtime-, Pending-, Filter- und Offlinewechseln;
- sichtbares Simulationsbanner bei ansonsten identischer Darstellung.

Die freigegebenen Referenzen liegen als lokale Konzeptartefakte im auftragsbezogenen
Visualisierungsverzeichnis. Browser-Screenshots werden dort getrennt als Implementierungsnachweis
abgelegt; sie sind keine Produktivdaten und enthalten nur synthetische Testwerte.

Die geometrische Live-Browserprüfung wurde in sämtlichen geforderten Viewports durchgeführt:

| Viewport | Dokumentüberlauf | Layout bei gespeicherter Zweispaltenwahl | Footer/Settings |
| --- | --- | --- | --- |
| 1920×1080 | keiner | zwei Spalten | vollständig im Viewport |
| 1600×900 | keiner | zwei Spalten | vollständig im Viewport |
| 1366×768 | keiner | zwei Spalten | vollständig im Viewport |
| 1280×720 | keiner | zwei Spalten | vollständig im Viewport |
| 1024×768 | keiner | kontrollierter Rückfall auf eine Spalte | vollständig im Viewport |
| 900×700 | keiner | kontrollierter Rückfall auf eine Spalte | vollständig im Viewport |
| 800×600 | keiner | kontrollierter Rückfall auf eine Spalte | vollständig im Viewport |
| 640×600 | keiner | kontrollierter Rückfall auf eine Spalte | vollständig im Viewport |

Bei 640×600 maß der Einstellungsdialog 478 Pixel Höhe. Kopf und 119 Pixel hohe Aktionsfläche
blieben fest; ausschließlich der 359 Pixel hohe Inhaltsbereich scrollte. Feste Seite, unbelegte
Seite, Setup, Split-Rotation, Light/Dark und der Zweispaltenrückfall wurden einzeln geprüft. Im
lokalen Simulator öffnete die gleich-originige Route `/simulation/fids` ohne Vorbereitungsfehler;
der gemeinsame React-Pfad, das Banner und die vollständige Simulationsprojektion sind zusätzlich
durch die gezielten UI- und Datenquellentests abgedeckt. Das native Popup wurde vom In-App-
Browser-Testtreiber nicht als separat aufnehmbarer Tab exponiert.

## Datenschutzkontrolle

- Teilbare Links enthalten nur Route, Veranstaltungs-ID und feste Seite.
- `setup`, PIN, Sitzung, Filterauswahl, Kontocode und Ticket-Token fehlen im Link.
- Audit und Outbox enthalten lediglich nicht sensitive Einstellungsmetadaten beziehungsweise Version.
- Die öffentliche Projektion enthält keine geschützten IDs oder Kontoeinstellungen.
