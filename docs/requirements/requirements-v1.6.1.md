# Kassen-Renderingkorrektur 1.6.1

Diese kompatible Fehlerkorrektur gehört zum Applikationsrelease `1.6.1`. Sie ergänzt die Fassung
V1.6.0 ausschließlich für das responsive Kassenlayout; alle übrigen Anforderungen aus V1.6.0 sowie
den Basiskatalogen V1.4 und V1.5 gelten unverändert fort.

| ID | Anforderung | Priorität |
| --- | --- | --- |
| V161-REL-010 | Applikation, Workspace-Pakete, Laufzeitmetadaten, Requirements, Traceability und UI-Referenzen verwenden konsistent die Patchversion `1.6.1`; Abweichungen werden automatisiert abgelehnt. | MUSS |
| V161-UI-010 | Die Kasse bleibt bei 1101 bis 1250 CSS-Pixeln im zweispaltigen Ein-Bildschirm-Aufbau. Produktname, Wartezeit, Kapazität und Preis sowie alle Kernspalten der Ticketliste sind ohne horizontales Abschneiden sichtbar. Nach einem Produktwechsel bleibt mindestens dessen Kopfzeile sichtbar; unterhalb von 1101 Pixeln gilt weiterhin die einspaltige Anordnung. | MUSS |
| V161-UI-020 | Die Ticketliste besitzt genau einen horizontalen und vertikalen Scroll-Eigentümer. Tabellenkopf und cursorbasiertes Nachladen bleiben funktionsfähig; im Leerzustand entsteht keine unnötige Scrollleiste. | MUSS |

## Ablösung älterer Festlegungen

- Die Tablet-Grenze aus V1.6.0 wird um einen kompakten iPad-Landscape-Bereich von 1101 bis 1250
  CSS-Pixeln ergänzt.
- Die verschachtelten Scrollbereiche der Ticketliste sind nicht Teil des freigegebenen Konzepts und
  werden durch einen einzigen äußeren Scrollbereich ersetzt.
