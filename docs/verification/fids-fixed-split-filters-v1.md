# Verifikation: feste FIDS-Seiten, Split, Filter und gemeinsame Simulation

Stand: 2026-08-02
Anforderungen: V173-FID-010, V173-PRI-010, V173-LAY-010, V173-SET-010, V173-AUT-010,
V173-API-010, V173-DAT-010, V173-OPS-010, V173-QA-010

## Automatisierte Abdeckung

| Ebene | Nachweis |
| --- | --- |
| Vertrag | Defaults, strikte Felder, Filtergrenzen und `priorityGroupCount < visibleRows` |
| Domain | reine Kapazitätsplanung, Actionable vor Recent departure vor PREPARE, disjunkte untere Seiten und relevanter Überlauf |
| Worker | explizite Actionable-/Recent-/Lower-Bänder, reale D1-Runtime-Projektion, Rollen und Public-Kompatibilität |
| React-Controller | URL-Seite, untere Rotation, Einmal-Ablauftimer, Schleifenfreiheit, ungültige Unterseite und letzter Offline-Stand |
| Simulation | derselbe Kapazitätsplan, dieselbe Reihenfolge und identische Seitenmetadaten ohne Live-Schreibpfad |
| Darstellung | Bereichs-Leerzustände, feste Slotanzahl, Seitentext, kompakte Zeitfenster, Langtext und zugängliche Ellipsen |

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
6. Die reale Workers-Runtime-D1-Projektion ordnet `CALLED` vor zwei noch sichtbaren Abflugzeilen und
   `PREPARE`; dieselben Abflugzeilen fehlen vollständig in `LOWER`, eine abgelaufene Abflugzeile fehlt
   in beiden Bereichen.
7. Die anonyme Board-Antwort bleibt am bestehenden Schema parsebar und enthält weder `rowId`,
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

Die Browserprüfung wurde für Live-FIDS und Simulation durchgeführt. Geprüft wurden:

- `FIXED_PAGE` und `SPLIT`, jeweils Light und Dark;
- 1920×1080, 1440×900, 1280×720, 1024×768, 800×600, 640×600 und zusätzlich 640×900;
- Setup-Leiste, Einstellungsdialog, leere Seite, ein Ergebnis, volle acht Plätze und relevanter
  Überlauf;
- ein- und zweispaltiges Layout einschließlich kontrolliertem Rückfall unter 1280 Pixel;
- kein horizontaler Dokument-, Dialog- oder Tabellenscroll und genau ein Dialog-Scrollbereich;
- stabile Kopf-, Tabellen- und Footerpositionen bei Status-, Seiten-, Filter- und Offlinewechseln;
- sichtbares Simulationsbanner bei ansonsten identischer Darstellung.

Die freigegebenen Referenzen liegen als lokale Konzeptartefakte im auftragsbezogenen
Visualisierungsverzeichnis. Browser-Screenshots werden dort getrennt als Implementierungsnachweis
abgelegt; sie sind keine Produktivdaten und enthalten nur synthetische Testwerte.

Die geometrische Simulatorprüfung wurde in sämtlichen geforderten Viewports durchgeführt:

| Viewport | Dokumentüberlauf | Layout bei gespeicherter Zweispaltenwahl | Footer/Settings |
| --- | --- | --- | --- |
| 1920×1080 | keiner | zwei Spalten | vollständig im Viewport |
| 1440×900 | keiner | zwei Spalten | vollständig im Viewport |
| 1280×720 | keiner | zwei Spalten | vollständig im Viewport |
| 1024×768 | keiner | kontrollierter Rückfall auf eine Spalte | vollständig im Viewport |
| 800×600 | keiner | kontrollierter Rückfall auf eine Spalte | vollständig im Viewport |
| 640×600 | keiner | kontrollierter Rückfall auf eine Spalte | vollständig im Viewport |
| 640×900 | keiner | kontrollierter Rückfall auf eine Spalte | vollständig im Viewport |

Die größte gemessene Differenz regulärer oder leer reservierter Zeilen betrug in der Simulation
0,016 CSS-Pixel bei 1920×1080 und 1440×900, ansonsten 0 Pixel. In der Live-Darstellung betrug sie bei
1440×900 und 640×900 jeweils 0 Pixel. Alle Status- und Zeitfensterzellen blieben einzeilig; lange
Gruppen-, Produkt- und Gatewerte wurden mit Ellipse gekürzt und behielten `title` sowie ihren
vollständigen zugänglichen Textinhalt. Die Seitenpräfixe waren breit als „SEITE 2 / 4“ und schmal als
„2 / 4“ sichtbar.

Bei 640×600 besaß der Einstellungsdialog keinen horizontalen Überlauf und genau einen scrollbaren
Inhaltsbereich. Kopf und Aktionen blieben im Viewport; die rein informativen Split-Hinweise erzeugten
keinen Tabstopp. Beide Split-Leerzustände lagen vollständig in ihrem Tabellenkörper, während
Abschnitts- und Spaltenköpfe sichtbar blieben. Die leere feste Seite belegte nach der Korrektur alle
acht physischen Zeilenspuren.

Der Simulator zeigte `BOARDING` beziehungsweise `BITTE ZUM GATE` vor drei kürzlich abgeflogenen
Zeilen; nach der beschleunigten Nachlaufzeit verschwanden diese Zeilen. Die untere Seite wechselte
von 1/2 auf 2/2, ohne die obere Ergebnismenge zu ändern. Live lieferte der geschützte Endpoint die
Statusfolge `BOARDING`, `COME_TO_FLIGHT_LINE`, `IN_FLIGHT`, `LANDED`, `COMPLETED`; die untere Seite
enthielt nur `WAITING` beziehungsweise `SERVICE_PAUSED`. Der obere Bereich erweiterte sich von drei
reservierten auf fünf belegte Plätze. Der aktive Nachruf, exakt ein gefiltertes Ergebnis sowie die
leere feste Seite wurden im Browser geprüft.

Für den Live-Ablauf wurde der isolierte lokale Worker kontrolliert unterbrochen. Der letzte bestätigte
Boardstand blieb sichtbar. Nach einer synthetischen Änderung und dem Neustart wurde der Wechsel einer
Zeile zu `BOARDING` hervorgehoben; separat erschien eine zuvor als `BOARDING` sichtbare Zeile als
`ABGEFLOGEN` und verschwand nach Ablauf der 30-sekündigen Veranstaltungseinstellung. Parallel sank
die Unterseitenzahl von 5 auf 1, während Seite 3 aktiv war; der Controller wechselte ohne sichtbaren
Leerzustand direkt auf 1/1. Der lokale Neustart-Harness erzeugte erwartete 403-Meldungen bei
WebSocket-Neuanmeldungen; der vorgesehene 15-Sekunden-Polling-Fallback stellte die Aktualisierung her.
Andere Konsolen-, Seiten- oder unerwartete Ressourcenfehler traten nicht auf.

Screenshots und JSON-Messberichte liegen ausschließlich im auftragsbezogenen lokalen
Visualisierungsverzeichnis und werden nicht committed. Das native Simulations-Popup wurde vom
In-App-Browser-Testtreiber nicht als eigener Tab exponiert; deshalb erfolgte die vollständige
Messung mit lokalem Playwright und installiertem Edge gegen dieselbe laufende Anwendung.

## Datenschutzkontrolle

- Teilbare Links enthalten nur Route, Veranstaltungs-ID und feste Seite.
- `setup`, PIN, Sitzung, Filterauswahl, Kontocode und Ticket-Token fehlen im Link.
- Audit und Outbox enthalten lediglich nicht sensitive Einstellungsmetadaten beziehungsweise Version.
- Die öffentliche Projektion enthält keine geschützten IDs oder Kontoeinstellungen.
