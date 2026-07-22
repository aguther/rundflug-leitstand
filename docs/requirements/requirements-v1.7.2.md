# Release 1.7.2 – Responsive Kasse und kompakte Flight Line

Diese kompatible Korrekturausbaustufe gehört zum Applikationsrelease `1.7.2`. Sie übernimmt
Release 1.7.1 sowie die fortgeltenden Kataloge V1.4 bis V1.7.0. Fachregeln, Rollen, öffentliche
Contracts, Worker-Kommandos und Persistenz bleiben unverändert. Die bereitgestellten Screenshots
und die bestätigten Entscheidungen bilden das freigegebene UI-Konzept.

| ID | Anforderung | Priorität |
| --- | --- | --- |
| V172-REL-010 | Applikation, Workspace-Pakete, Requirements, Traceability und UI-Konzepte verwenden konsistent Version `1.7.2`. | MUSS |
| V172-FOC-010 | Suchfelder zeigen bei Tastaturfokus genau einen gemeinsamen Fokusrahmen am äußeren Container; ein innerer blauer Balken oder ein Verlust der zugänglichen Fokuskennzeichnung ist unzulässig. | MUSS |
| V172-CAS-010 | Die Kassen-Produktliste zeigt kein Flugzeugsymbol und verteilt Produktname, Kennzahlen, Preis und Verkaufsaktion ohne intrinsische Mindestbreite so, dass links kein horizontaler Tabellenüberlauf entsteht. Die Ticketliste bleibt unverändert. | MUSS |
| V172-SUP-010 | Die Supervisor-Flugzeugtabelle ist ab 768 CSS-Pixel ohne horizontalen Überlauf bedienbar. Plätze, Ressource und Pilotencode stehen als drei kompakte Zeilen in Details; Pilotwechsel ist die sechste Zeilenaktion zwischen Nicht verfügbar und Historie. Symbole und Zeiten der Zeitlinie bleiben gut lesbar, ohne die Zeilenhöhe zu vergrößern; ihre Symbolachse liegt mittig zu den Aktionsbuttons. | MUSS |
| V172-TKT-010 | Nur offene Tickets ist initial aktiv. Die verkaufte Ticketliste verwendet eine kompakte feste Spaltenmatrix, reserviert dauerhaft die vertikale Scrollbarbreite und besitzt symbolische sortierbare Köpfe mit Tooltip und zugänglichem Namen. | MUSS |
| V172-TIM-010 | Assist und Supervisor zeigen Verfügbar, Boarding, Off-Block, On-Block und den dynamischen Endzustand ausschließlich als Symbole. Nur Boarding bis On-Block ist verbunden; Linien liegen ausschließlich zwischen den Symbolkanten. Zeiten bleiben gut lesbar und stabil darunter und fehlen sichtbar leer. Der Endpunkt ist je Folgezustand `Fuel`, `Coffee` oder `CircleX`. | MUSS |
| V172-ACT-010 | Bei `LANDED` schließen vier gleichrangige Ein-Tipp-Aktionen den Umlauf direkt nach `AVAILABLE`, `REFUELING`, `PAUSED` oder `INACTIVE` ab. Während der Serverbestätigung ist die betroffene Aktionsgruppe gegen konkurrierende Doppeltipps gesperrt. | MUSS |
| V172-AST-010 | Assist verwendet dieselben vier Abschlussaktionen ohne separate Folgezustandsauswahl, 56-Pixel-Aktionsziele ohne unnötige Trennlinie sowie getrennt umrandete Nachbarelemente für Pilotencode und Pilotwechsel. Mobil stehen Status, Buchungsgruppen und Pilot untereinander; Beschriftungen und Werte sind vertikal zentriert und alle Werte beginnen an derselben horizontalen Position. Für Buchungsgruppen bleiben zwei Zeilen stabil reserviert; erst darüber hinaus wächst die Zeile bei tatsächlichem Umbruch. Ohne aktiven oder früheren Umlauf bleibt diese normale Ansicht mit leeren Umlauffeldern sichtbar; eine vorhandene Flugzeug-Verfügbarkeitszeit bleibt in der Zeitlinie erhalten. Die Ansicht bleibt bei 320×568 ohne Dokument-Scroll bedienbar. | MUSS |
| V172-CLM-010 | „Bewusst übernehmen“ erscheint als gelbe, ungefüllte Warnaktion. Während jeder Übernahmeanfrage zeigt der größenstabile Button blau gefüllt einen Spinner und „Wird übernommen …“ und sperrt andere Übernahmen. Nach Freigabe besitzt Aktualisieren auf Touch-Geräten keinen haftenden blauen Hoverzustand; Tastaturfokus bleibt erhalten. | MUSS |
| V172-QA-010 | Automatisierte Prüfungen und Browserabnahme in Light und Dark decken die festgelegten Kassen-, Supervisor- und Assist-Viewports sowie Fokus, Überlauf, Zeitlinienzustände, Abschlusswege, Pilotwechsel, Freigabe, Aktualisieren und Übernahme ab. | MUSS |

## Schnittstellen und Persistenz

Interne Supervisor- und Assist-Callbacks dürfen den gewählten Abschluss-Folgezustand übergeben.
Das bestehende `COMPLETE_TURNAROUND`-Payload wird damit unverändert befüllt. Es entstehen weder
öffentliche API-, Contract-, Domain- oder Datenbankänderungen noch eine Migration.

## Abnahme

- Kasse: 834×1112, 1024×768, 1194×679 und 1366×768.
- Supervisor: 768×1024, 1024×768, 1366×768 und 1536×1024.
- Assist: 320×568, 390×844, 430×932 und 768×1024.
- Light und Dark, Dokument- und Tabellenüberlauf, reservierte Scrollbarbreite, Suchfokus,
  Zeitlinienzustände, alle vier direkten Abschlusswege, Pilotwechsel, Freigabe/Aktualisieren sowie
  Übernahme-Erfolg und -Fehler.
