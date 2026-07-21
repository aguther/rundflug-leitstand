# Release 1.7.0 – Kompakte Kasse, segmentierte Gruppen und Overlay-Meldungen

Diese funktionale Ausbaustufe gehört zum Applikationsrelease `1.7.0`. Sie übernimmt die
Anforderungen aus V1.6.1 sowie den fortgeltenden Katalogen V1.4, V1.5 und V1.6.0 und konkretisiert
die Kasse, die Abfertigung bewusst aufgeteilter Buchungsgruppen und die Darstellung betrieblicher
Meldungen. API- und Datenbankverträge für Gewichtsklassen und vorgedruckte Ticketcodes bleiben zur
Kompatibilität bestehen; es gibt keine Migration und keine neue Abhängigkeit.

| ID | Anforderung | Priorität |
| --- | --- | --- |
| V17-REL-010 | Applikation, Workspace-Pakete, Laufzeitmetadaten, Requirements, Traceability, Arbeitsanweisung und UI-Konzept verwenden konsistent die Minorversion `1.7.0`; Abweichungen werden automatisiert abgelehnt. | MUSS |
| V17-KAS-010 | Die Kasse zeigt genau einen gemeinsamen Gruppengrößenzähler oberhalb einer beliebig langen Produktliste. Jedes Produkt bleibt eine kompakte, nicht aufklappende Zeile mit Name, Wartezeit, Kapazität, Preis und eigener Verkaufsaktion. Mindestens drei Produkte sind ohne Auswahl- oder Akkordeonabhängigkeit bedienbar. | MUSS |
| V17-KAS-020 | Jedes Produkt reserviert unabhängig vom aktuellen Gruppenumfang denselben Platz für einen Aufteilungshinweis. Nur bei notwendiger Aufteilung erscheint dort eine kompakte Warnung mit Segmentgrößen, Reihenfolge und dem Hinweis, dass die Buchungsgruppe verbunden bleibt; die Warnung verändert die Zeilen- und Seitengeometrie nicht und erfordert keine zusätzliche Bestätigung. | MUSS |
| V17-KAS-030 | Gewichtserfassung, Kinder-Begleithinweis und Auswahl der Ticket-Ausgabe sind in Kasse und Produktverwaltung vorerst operativ ausgeblendet. Neue Kassenverkäufe erzeugen ausschließlich systemgenerierte QR-Ticketcodes und speichern `NOT_CAPTURED`, sofern kein kompatibler Altclient explizite Ticketdetails sendet. Bestehende Contracts, gespeicherte Produktkonfigurationen und die Annahme expliziter Altclient-Daten bleiben erhalten. | MUSS |
| V17-KAS-040 | Nach einem serverseitig bestätigten Verkauf springt die Gruppengröße auf `1` zurück, auch wenn die anschließende Druckvorbereitung fehlschlägt. Bei abgelehnten oder technisch fehlgeschlagenen Verkäufen bleibt die eingegebene Gruppengröße erhalten. | MUSS |
| V17-OPS-010 | Eine bewusst aufgeteilte Buchungsgruppe wird segmentweise aufgerufen. `CALL_NEXT` wählt deterministisch das früheste noch nicht aufgerufene DRAFT-Segment, bewertet nur dessen Ticketzahl gegen die Flugzeugkapazität und verschiebt ausschließlich Tickets dieses Segments. Gesamtgruppe, Segmentgröße, Segmentindex und Segmentanzahl bleiben unterscheidbar; solange ein DRAFT-Segment verbleibt, bleibt die Gruppe queuefähig. `COMPLETED` gilt erst nach Abschluss aller Segmente. | MUSS |
| V17-TKT-010 | Die Ticketvorschau zeigt auf Desktop und iPad den vollständigen kompakten Ticketzettel ohne internen Scrollbereich. Eine zugängliche Aktion öffnet einen modalen Scan-Dialog mit großem QR-Code, Ticketcode und Position; Schließen per Schaltfläche, Escape und Hintergrund ist möglich. Das 58-mm-Drucklayout bleibt unverändert. | MUSS |
| V17-UI-010 | In der iPad-Landscape-Tickethistorie besitzen Status und Summe einen deutlich sichtbaren Abstand. Der Status „Abgeschlossen“ und der Preis berühren oder überlagern sich nicht; alle sieben Kernspalten bleiben ohne horizontalen Seitenüberlauf sichtbar. | MUSS |
| V17-UI-020 | Zustands- und Betriebsmeldungen am oberen Rand erscheinen ansichtsübergreifend als gestapelter, fester Benachrichtigungsbereich über der Seite und nehmen keinen Platz im Dokumentfluss ein. Jede Meldung ist einzeln zugänglich schließbar. Ein neuer Zustand oder geänderter Meldungsinhalt wird erneut angezeigt; fachliche Dialoge bleiben darüber bedienbar. | MUSS |
| V17-UI-030 | Das Ansichtsmenü bleibt bis 320 CSS-Pixel vollständig innerhalb des Viewports. Menüzeilen ordnen Symbol, umbrechbaren Text und Status beziehungsweise Auswahlhaken ohne Abschneiden an; Touchziele sind mindestens 44 Pixel hoch und Fokusdarstellung sowie Light-/Dark-Theme bleiben erhalten. | MUSS |
| V17-FL-010 | Assist zeigt ohne eigenen Claim ausschließlich die scrollbare Flugzeugauswahl und nach erfolgreicher Übernahme ausschließlich die Arbeitsansicht dieses Flugzeugs. Der Server-Claim stellt den Modus nach Reload wieder her. Nur die manuelle Aktion „Flugzeug freigeben“ beendet regulär den Claim, leert Flugzeug- und Gruppenauswahl und kehrt zur Liste zurück; Claim-Verlust oder -Widerruf erzwingt die Rückkehr mit verständlichem Hinweis. | MUSS |
| V17-FL-020 | Assist verwendet für Flugzeugstatus, Statuszeit, Pilotencode, Ist-Zeitlinie, Umlaufhistorie und Zustandsaktionen dieselbe Präsentations- und Bedienlogik wie der Supervisor. `FLIGHT_LINE` darf zulässige, erwartungsversionierte und idempotente Flugzeugzustandswechsel einschließlich `INACTIVE` nach `AVAILABLE` ausführen; Pilotwechsel bleibt gemäß `V161-FL-030` ausschließlich Flugleitung und Administration vorbehalten. | MUSS |
| V17-FL-030 | Assist und Supervisor verwenden eine gemeinsame Ist-Zeitlinie mit den Stationen Boarding, Off-Block, On-Block und Verfügbar sowie einem davon nicht verbundenen Endpunkt Nicht verfügbar. Tanken wird gelb beziehungsweise orange, Pause violett und eine unspezifische Nichtverfügbarkeit rot dargestellt. Dieselbe Farbe kennzeichnet Status, aktuellen Zeitlinienpunkt und aktive Icon-Aktion. Pilotenanzeige und Pilotwechsel verwenden konsistent User- beziehungsweise User-Pen-Symbole; Primäraktionen besitzen je Ansicht eine zustandsunabhängig feste Breite, ein eindeutiges Symbol und einen kompakten Text. | MUSS |
| V17-UI-040 | Transiente Aktionsrückmeldungen erscheinen ansichtsübergreifend als gestapelte Nachrichten rechts oben. Erfolg und Information verschwinden nach fünf Sekunden, Aktionsfehler nach zehn Sekunden; Hover und Tastaturfokus pausieren die Frist. Offlinezustand, unbestätigter Verbindungsstand, Notfallmodus, Betriebsunterbrechung, Betriebshinweise und notwendige Einrichtungswarnungen bleiben bis zur Zustandsänderung oder manuellen Schließung sichtbar. | MUSS |
| V17-UI-050 | Die scrollbare Assist-Flugzeugauswahl verwendet auf Desktop eine schmale, abgerundete und themefähige Scrollbar. Touchgeräte ohne internen Listen-Scrollbereich behalten den Dokument-Scroll; bei 320 CSS-Pixeln entsteht kein horizontaler Dokumentüberlauf. | SOLL |

## Ablösung und Fortgeltung

- Die aufklappende Produktauswahl aus V1.6.0/V1.6.1 wird für die Kasse durch feste Produktzeilen
  ersetzt. Die iPad-Breakpoints und der eindeutige Ticketlisten-Scroll-Eigentümer aus V1.6.1
  gelten fort.
- Die sichtbare Gewichtserfassung aus `F-KAS-030`, der gewichtsspezifische UI-Anteil aus
  `Q-WAR-020` und die sichtbare Auswahl vorgedruckter Ticketcodes werden für V1.7.0 operativ
  suspendiert. Sicherheits- und Freigabesemantik bleibt weiterhin ausgeschlossen.
- Die bewusste Verkaufsaktion mit sichtbarer Aufteilungsfolge erfüllt weiterhin den Gruppenschutz.
  Eine zusätzliche Bestätigungsschaltfläche ist nicht erforderlich.
- Bestehende API-, Datenbank-, Audit-, Idempotenz- und Concurrency-Anforderungen gelten
  unverändert. Die neuen Queue-Felder sind additive, optional lesbare Projektionseigenschaften.
- Die frühere Tablet-Zweispaltenansicht der Assist-Oberfläche wird durch ADR-0019 und die getrennten
  Auswahl- und Arbeitsmodi aus `V17-FL-010` ersetzt.

## Abnahme

- Kasse mit mindestens drei synthetischen Produkten bei 1600×980, 1366×768 und 1194×679 sowie
  einspaltig bei 1024×768 und 834×1112; zusätzlich Hell/Dunkel und 200 Prozent Textvergrößerung.
- Verkauf einer Gruppe 4 bei maximal 3 Sitzen: erster Aufruf 3 Personen, nächster Aufruf 1 Person,
  gleiche Buchungsgruppe, unmittelbar folgende Kommunikationskennungen und Abschluss erst nach
  beiden Segmenten.
- Aktive, stornierte und leere Ticketlisten, lange Produktbezeichnung, Status „Abgeschlossen“,
  cursorbasiertes Nachladen und genau ein Tabellen-Scroll-Eigentümer.
- Vollständige Vorschau und QR-Scan-Dialog auf iPad/desktop; Druckabnahme unverändert 58 mm.
- Offline-, Verbindungs-, Notfall-, Unterbrechungs- und Betriebshinweis einzeln sowie gestapelt:
  kein Layoutsprung, Schließen funktioniert und geänderte Meldungen erscheinen erneut.
- Assist bei 390×844, 430×932, 768×1024, 1024×768 und 1536×1024: Übernahme, exklusive
  Arbeitsansicht, Nicht verfügbar/Verfügbar, Tanken, Pause, Umlaufzeitlinie und manuelle Freigabe.
- Gemeinsame Flight-Line-Zeitlinie bei Boarding, Off-Block, On-Block, Turnaround, Verfügbar,
  Tanken, Pause und Nicht verfügbar: durchgehende Rail bis Verfügbar, kein Strich zum separaten
  Endpunkt Nicht verfügbar und identische aktive Farben in Status, Timeline und Aktion.
- Aktionsrückmeldungen aus Flight Line, Kasse, Administration, Einrichtung und Kontenverwaltung:
  fünf beziehungsweise zehn Sekunden, pausierbar per Hover/Fokus; betriebliche Dauermeldungen
  bleiben davon unberührt.
- Ansichtsmenü bei 320, 390 und 430 Pixeln ohne horizontalen Dokumentüberlauf oder abgeschnittenen
  Auswahlhaken.
