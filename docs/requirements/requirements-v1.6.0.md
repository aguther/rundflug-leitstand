# Kassen- und Druckausbaustufe 1.6.0

Diese freigegebene Ergänzung gehört zum Applikationsrelease `1.6.0`. Sie konkretisiert und
überstimmt bei Widersprüchen die Fassungen V1.4 und V1.5; deren Binärreferenzen bleiben unverändert.

| ID | Anforderung | Priorität |
| --- | --- | --- |
| V16-REL-010 | Applikation, Workspace-Pakete, Laufzeitmetadaten, Requirements, Traceability und UI-Referenzen verwenden dieselbe Releaseversion `1.6.0`; Abweichungen werden automatisiert abgelehnt. | MUSS |
| V16-KAS-010 | Jedes Produkt besitzt an stabiler Position seine eigene Verkaufsaktion. Sie verkauft die aktuell gewählte Gruppengröße genau für dieses Produkt und ist während des idempotenten Kommandos gesperrt. | MUSS |
| V16-KAS-015 | Die Produktliste bleibt bei mehr als zwei Produkten vollständig bedienbar. Sie besitzt einen eigenen stabilen Scrollbereich, bringt das gewählte Produkt in den sichtbaren Bereich und hält Warnung sowie Verkaufsaktion kompakt. | MUSS |
| V16-KAS-020 | Die produktbezogene Hinweisfläche ist in jedem Zustand gleich groß. Ohne Aufteilung zeigt sie einen neutralen Kapazitätshinweis, mit Aufteilung die vollständigen Auswirkungen; Produktkarte und Verkaufsaktion dürfen dadurch nicht springen. | MUSS |
| V16-KAS-030 | Die Kassenliste zeigt aktive und stornierte Buchungsgruppen mit kanonischen Statuswerten, stabiler Kommunikationsnummer, cursorbasierter Fortsetzung und gezielter Revalidierung nach Realtime-Ereignis, Fokus, Verkauf, Storno oder manueller Aktualisierung. | MUSS |
| V16-KAS-040 | Storno erfordert einen Grund, wird versioniert, idempotent und append-only auditiert und gibt aktive Umlaufzuordnungen sowie Kapazität unmittelbar frei. Die stornierte Gruppe bleibt ausgewählt und sichtbar. | MUSS |
| V16-KAS-050 | Neue Umbuchungen sind nicht zulässig. Die operative Korrektur besteht aus Storno und bewusstem Neuverkauf mit neuer Buchungsgruppe und aktueller Queue-Position; historische Umbuchungsereignisse bleiben lesbar. | MUSS |
| V16-TKT-010 | Vorschau und Druck verwenden dasselbe 58-mm-Ticketdokument mit Veranstaltung, Produkt, Eingang, stabiler Buchungsgruppe, Ticketposition, Ticketcode, großem QR-Code und Statushinweis, ohne Gast-, Zahlungs- oder Summendaten. | MUSS |
| V16-TKT-020 | Der Druckdialog darf erst nach vollständiger Daten- und QR-Bereitstellung geöffnet werden. Ein Druckfehler ändert den bestätigten Verkauf nicht; vollständiger Nachdruck bleibt für nicht stornierte Gruppen möglich. | MUSS |
| V16-UI-010 | `docs/ui/v1.6.0-cashier-concept.md` ist zusammen mit der V1.5-Kassenreferenz und den darin dokumentierten Abweichungen die verbindliche visuelle Spezifikation. | MUSS |

## Ablösung älterer Festlegungen

- `F-KAS-080` wird für neue Kommandos durch `V16-KAS-050` ersetzt.
- Der Bestätigungsschritt „Aufteilung verstanden“ entfällt. Die Aufteilungsinformation ist eine
  dauerhaft reservierte, passive Produktinformation.
- Die Verkaufsaktion befindet sich nicht mehr unterhalb aller Produkte, sondern im jeweils
  ausgewählten Produktbereich.
