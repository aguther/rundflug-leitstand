# Release 1.9.1 – Verkaufskapazität, POS-58 und öffentliche Statuskorrekturen

Diese kompatible Korrekturausbaustufe gehört zum Applikationsrelease `1.9.1`. Sie übernimmt Release
1.9.0 und die fortgeltenden Kataloge V1.4 bis V1.9.0. Die folgenden Anforderungen konkretisieren
das am 24. Juli 2026 freigegebene Korrekturkonzept.

| ID | Anforderung | Priorität |
| --- | --- | --- |
| V191-REL-010 | Applikation, Workspace-Pakete, Requirements, Traceability und UI-Konzept verwenden konsistent Version `1.9.1`. | MUSS |
| V191-CAS-010 | Temporäre Flugzeugzustände `REFUELING`, `PAUSED`, `INACTIVE` beziehungsweise `INTERRUPTED`, pausierte Piloten, eine unsichere Prognose oder ausgeschöpfte Prognosekapazität bleiben an der Kasse sichtbar, sperren einen ansonsten ausdrücklich freigegebenen Verkauf aber nicht. Technische Sperren bleiben für inaktive Veranstaltungen, Verkaufsbeginn und -schluss, deaktivierte Produkte, nicht aktive Ressourcengruppen, globale Unterbrechung, Notfall, fehlende Serverbestätigung und laufende Schreibvorgänge erhalten. Die gewählte Personenanzahl bleibt nach erfolgreichem Verkauf stehen und besitzt einen expliziten Reset auf `1`. | MUSS |
| V191-GRP-010 | Die Gruppenkapazität für Aufteilungsanzeige und Verkauf wird aus allen Flugzeugen mit aktiver Ressourcengruppenzuordnung abgeleitet. Temporäre Betriebszustände verändern Prognose und Disposition, aber nicht diese Gruppenkapazität. Erst das administrative Beenden der Zuordnung wirkt als harte Deaktivierung. | MUSS |
| V191-PRN-010 | Der POS-58-Ausdruck enthält ausschließlich das Ticket, beginnt ohne Vorlauf, besitzt keine feste Rollenlänge, verwendet einen 56-mm-Inhalt mit 52-mm-QR-Code und vergrößerter Schrift und zentriert den Inhalt links/rechts auf der 58-mm-Rollenachse. Direktdruck bleibt eine dokumentierte Betriebskonfiguration des Browsers und Standarddruckers, keine Umgehung des Browser-Sicherheitsmodells durch die PWA. | MUSS |
| V191-PUB-010 | Die öffentliche Ticket- und Gruppen-PWA verwendet auf iPhones den dynamisch sichtbaren Viewport ohne leeren Dokumentüberlauf und erlaubt internes Scrollen nur bei tatsächlich höherem Inhalt. `IN_FLIGHT` wird als `IM FLUG`, `LANDED` als `GELANDET` bezeichnet. | MUSS |
| V191-FID-010 | FIDS-Zeitfenster behalten Inhalt und Präfix `ca.`, verzichten aber auf das nachgestellte Wort `Uhr`. Andere Ansichten behalten ihre bestehende Zeitfensterformatierung. | MUSS |
| V191-QA-010 | Unit-, Worker-Integrations-, UI-, Druck- und Browserabnahmen decken alle temporären Flugzeugzustände, stabile Gruppenkapazität, explizite Verkaufssperren, Personenreset, isolierten vergrößerten POS-58-Druck, iPhone-Viewport, öffentliche Statustexte und FIDS-Zeitfenster ab. | MUSS |

## Fachliche Abgrenzung

Die Anforderungen `F-FLT-050`, `F-FLT-090`, `F-PRG-030` und `F-KAP-010` bleiben für Prognose und
Disposition unverändert: Tanken, Pause und Nichtverfügbarkeit nehmen ein Flugzeug weiterhin aus
der aktuell prognostizierten Kapazität. `V191-CAS-010` konkretisiert, dass dieser Hinweis keinen
automatischen Verkaufsstopp darstellt. `V191-GRP-010` konkretisiert `F-SLT-070`: Für die bewusste
Aufteilung einer beim Verkauf verbunden bleibenden Buchungsgruppe zählt die maximale Kapazität der
aktiv zugeordneten Flotte, nicht deren momentaner Betriebszustand.

Es entstehen keine neuen Domänenzustände, Datenbankfelder oder Zustandsübergänge.

## Freigegebene UI-Referenz

Das Korrekturkonzept ist in `docs/ui/v1.9.1-cashier-concept.md` festgehalten. Die einmalige
Betriebskonfiguration für unterstützten Direktdruck steht in
`docs/operations/pos-58-direct-print.md`.
