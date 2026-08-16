# 1. Einführung und Ziele

Der Rundflug-Leitstand ist ein webbasiertes Operations-Management-System für Rundflüge auf
Flugplatzfesten und Fly-Ins. Er koordiniert Ticketverkauf, Warteschlangen, Flugumläufe, Flotten- und
Pilotenverfügbarkeit, Prognosen, öffentliche Anzeigen und die vollständige Auditierung eines
Veranstaltungstages.

Maßgebliche fachliche Quelle ist der Anforderungskatalog `docs/requirements/requirements-v1.12.0.md`
mit 341 kumulativen Anforderungen auf Basis des unveränderten Lastenhefts V1.4. Diese
arc42-Dokumentation beschreibt den tatsächlich implementierten Architekturstand der Anwendungsversion
**1.12.0** (Abnahmestand, noch nicht produktiv freigegeben).

## 1.1 Aufgabenstellung

Ein Veranstaltungstag besteht aus wenigen Flugzeugen, vielen kurzfristig entstehenden Buchungen und
einer Besuchermenge, die keine festen Uhrzeiten erhält. Der Leitstand ersetzt Zettelwirtschaft,
Zurufe und improvisierte Wartelisten durch einen gemeinsamen, konfliktgeprüften Betriebszustand.

Wesentliche Aufgaben:

- **Verkauf:** anonyme Ticketgruppen mit Produkt, Gewichtsklassen und Kapazitätsprüfung; Ticketdruck
  und QR-Code für den öffentlichen Status.
- **Warteschlange und Disposition:** genau eine operative Queue je Ressourcengruppe, stabile
  Fluggruppennummern, Dispatch-Empfehlungen und automatischer Voraufruf.
- **Flight-Line-Betrieb:** bestätigte Ist-Ereignisse `NEXT`, `IM FLUG`, `GELANDET`, `ABGESCHLOSSEN`
  inklusive Anwesenheit, Zurückstellung, No-Show und Gruppennachruf.
- **Flotte und Personal:** Flugzeug- und Pilotenzustände, Pausen, Betankung, Unterbrechungen,
  wiederkehrende Betriebsregeln und ein weicher Betriebsplan als reiner Prognoseeingang.
- **Prognose und Kapazität:** aus Ist-Daten lernende Zeitfenster mit ausgewiesener Unsicherheit sowie
  eine konservative Verkaufsfreigabe je Produkt.
- **Gast- und Besucherinformation:** anonymer Ticket- und Gruppenstatus, FIDS-Monitore, Web-Push.
- **Nachweis und Betrieb:** append-only Auditprotokoll, Tagesberichte, portable Sicherungen,
  Papier-Rückfallebene und Nacherfassung.

Ausdrücklich **nicht** Aufgabe des Systems: flugbetriebliche, sicherheitsrelevante oder
luftrechtliche Entscheidungen. Gewichts-, Kraftstoff- und Kapazitätshinweise sind organisatorische
Hinweise ohne Freigabewirkung. Zahlungsabwicklung, Passagierlisten und Personendaten liegen außerhalb
des Kernsystems.

## 1.2 Qualitätsziele

Die fünf für die Architektur bestimmenden Qualitätsziele. Die vollständige Liste steht in Kapitel 10.

| Priorität | Qualitätsziel | Motivation | Anforderungen |
| --- | --- | --- | --- |
| 1 | **Konsistenz unter paralleler Bedienung** – keine Doppelbuchung, kein stiller Überschreibvorgang, jede Änderung auditiert | Mehrere Helferinnen und Helfer bedienen dasselbe Aggregat gleichzeitig, teils mit Doppel-Tipp auf Tablets | Q-UX-050, Q-ZUV-040, Q-ZUV-020 |
| 2 | **Betriebsfähigkeit bei schlechter Verbindung** – letzter bestätigter Stand bleibt sichtbar, automatische Wiederverbindung, dokumentierte Papier-Rückfallebene | Flugplatzgelände mit Mobilfunklücken; ein Abbruch darf den Veranstaltungstag nicht stoppen | Q-ZUV-020, Q-ZUV-030, Q-ZUV-070 |
| 3 | **Datensparsamkeit und Zugriffsschutz** – keine Gastnamen, nicht erratbare öffentliche Codes, EU-Verarbeitung | Öffentlich erreichbare Statusseiten ohne Anmeldung; ehrenamtlicher Betrieb ohne Datenschutzabteilung | Q-DSG-010, Q-SIC-030, Q-DSG-040 |
| 4 | **Verständliche Bedienung unter Zeitdruck** – Ein-Bildschirm-Abläufe, höchstens zehn Minuten Einweisung je Rolle | Wechselnde ehrenamtliche Besetzung, Sonnenlicht, Handschuhe, Zeitdruck an der Kasse | Q-UX-020, Q-UX-060, Q-UX-070 |
| 5 | **Wartbarkeit und niedrige Betriebskosten** – Standardtechnologien, konfigurierbar ohne Deployment, höchstens 15 Euro Grundkosten je Monat | Ein Verein muss das System ohne Herstellerbindung und ohne Dauerbudget betreiben können | Q-WAR-010, Q-WAR-020, Q-WAR-030 |

Zusätzlich verbindlich, aber der Architektur weniger formgebend: Reaktion der Oberfläche unter 300 ms,
Prognoselauf höchstens zwei Sekunden im festgelegten Mengengerüst (Q-PER-010, Q-PER-030) und 99,5
Prozent Verfügbarkeit im Veranstaltungszeitraum (Q-ZUV-060).

## 1.3 Stakeholder

| Rolle | Erwartung an die Architektur |
| --- | --- |
| Verein als Betreiber | geringe laufende Kosten, Übergabefähigkeit, kein Anbieter-Lock-in, nachweisbarer Datenschutz |
| Kasse (`CASHIER`) | schneller Verkauf ohne Menünavigation, verlässliche Kapazitätsaussage, druckbares Ticket |
| Flight Line (`FLIGHT_LINE`) | mobile Ein-Bildschirm-Bedienung, keine versehentlichen Doppelaktionen, klare Aufrufkette |
| Flight Director (`FLIGHT_DIRECTOR`) | Gesamtüberblick, Dispatch-Empfehlungen, Steuerung von Pausen, Unterbrechungen und Notfallmodus |
| Administration (`ADMIN`) | Stammdaten, Veranstaltungsparameter, Konten, Reset, Auswertung – ohne Codeänderung |
| FIDS-Monitor (`DISPLAY`) | dauerhaft laufende, gebundene Anzeige ohne Bedienung und ohne Zugriff auf operative Funktionen |
| Gäste und Besucher | anonymer Status ohne Anmeldung, handlungsorientierte Aussagen statt scheinpräziser Uhrzeiten |
| Entwicklung und Wartung | lesbare Domänenlogik ohne Plattformabhängigkeit, ausführbare Verträge und Tests |
| Datenschutzverantwortliche | dokumentierter Datenfluss, Löschfristen, EU-Jurisdiktion, keine externen Tracker |
