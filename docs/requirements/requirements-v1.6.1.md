# Release 1.6.1 – Kassenkorrektur und Flight-Line-Überarbeitung

Diese kompatible Fehlerkorrektur gehört zum Applikationsrelease `1.6.1`. Sie ergänzt die Fassung
V1.6.0 um das responsive Kassenlayout und die kompakte Flight-Line-Steuerung; alle übrigen
Anforderungen aus V1.6.0 sowie den Basiskatalogen V1.4 und V1.5 gelten unverändert fort.

| ID | Anforderung | Priorität |
| --- | --- | --- |
| V161-REL-010 | Applikation, Workspace-Pakete, Laufzeitmetadaten, Requirements, Traceability und UI-Referenzen verwenden konsistent die Patchversion `1.6.1`; Abweichungen werden automatisiert abgelehnt. | MUSS |
| V161-UI-010 | Die Kasse bleibt bei 1101 bis 1250 CSS-Pixeln im zweispaltigen Ein-Bildschirm-Aufbau. Produktname, Wartezeit, Kapazität und Preis sowie alle Kernspalten der Ticketliste sind ohne horizontales Abschneiden sichtbar. Nach einem Produktwechsel bleibt mindestens dessen Kopfzeile sichtbar; unterhalb von 1101 Pixeln gilt weiterhin die einspaltige Anordnung. | MUSS |
| V161-UI-020 | Die Ticketliste besitzt genau einen horizontalen und vertikalen Scroll-Eigentümer. Tabellenkopf und cursorbasiertes Nachladen bleiben funktionsfähig; im Leerzustand entsteht keine unnötige Scrollleiste. | MUSS |
| V161-UI-030 | Der gemeinsame Disclaimer-/Versionsfooter entfällt in allen Anwendungsansichten. Die obere Navigation bietet stattdessen eine zugängliche Informationsschaltfläche mit „Rundflug-Leitstand · Version 1.6.1“. Fachliche FIDS-Inhaltsleisten bleiben unverändert. | MUSS |
| V161-FL-010 | Der Supervisor verwendet eine einzige kompakte, vertikal scrollbare Flugzeugtabelle mit fixiertem Kopf und ausgewählter Zeile. Alle Flugzeuge bleiben auch auf iPad-Viewports erreichbar; die Tabelle darf horizontal innerhalb ihres eigenen Bereichs scrollen, das Dokument selbst jedoch nicht unkontrolliert überlaufen. Status erscheinen ausschließlich deutsch und semantisch lesbar mit der Uhrzeit des letzten echten Zustandswechsels. | MUSS |
| V161-FL-020 | Die Flugzeugzeile klappt nicht auf. Primäraktion sowie zugängliche Symbolaktionen für Pilot, Tanken, Pause und Nicht verfügbar stehen kompakt in der Zeile. Die Auswahl vollständiger, anwesender und kapazitätskonformer Buchungsgruppen erfolgt ausschließlich in einem zentrierten Dialog. Ohne Pilotvormerkung bleibt die Auswahl möglich, die Bestätigung jedoch mit einem Hinweis auf „Pilot zuweisen“ gesperrt. | MUSS |
| V161-FL-030 | Die Pilotzuweisung ist ein eigenes, ausschließlich für Flugleitung und Administration zulässiges, erwartungsversioniertes und idempotentes Kommando. Es akzeptiert nur aktive, nicht pausierte anonyme Codes. Änderungen sind ohne aktiven Umlauf und während Boarding erlaubt, ab Offblock bis Abschluss gesperrt. Das bestätigte Umhängen einer konfliktfreien Vormerkung ändert betroffene Flugzeuge und einen Boarding-Umlauf atomar und erzeugt genau ein append-only Ereignis `AIRCRAFT_PILOT_CHANGED` samt Beleg und Outbox. `CALL_NEXT` akzeptiert nur den bereits am Flugzeug hinterlegten Code. | MUSS |
| V161-FL-040 | Aktueller Umlauf und Historie zeigen deutschsprachigen Status, gemeinsam geflogene Buchungsgruppen, Pilotencode sowie Boarding-, Offblock-, Onblock- und Abschluss-/Folgestatuszeit. Die Historie besitzt genau eine Zeile je abgeschlossenem Umlauf. Technische Rohwerte wie `IN_FLIGHT` werden in Flight-Line- und Ticketbereichen nicht ausgegeben. | MUSS |

## Ablösung älterer Festlegungen

- Die Tablet-Grenze aus V1.6.0 wird um einen kompakten iPad-Landscape-Bereich von 1101 bis 1250
  CSS-Pixeln ergänzt.
- Die verschachtelten Scrollbereiche der Ticketliste sind nicht Teil des freigegebenen Konzepts und
  werden durch einen einzigen äußeren Scrollbereich ersetzt.
- ADR-0012 bleibt für die flugzeugzentrierte Abfertigung und den Voraufruf gültig; die dort gemeinsam
  mit der Belegung bestätigte Pilotenauswahl wird durch ADR-0018 und `V161-FL-030` ersetzt.
