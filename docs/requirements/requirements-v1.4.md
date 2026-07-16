# Lastenheft Rundflug-Leitstand v1.4 – durchsuchbare Fassung

> Automatisch aus der konsolidierten DOCX-Referenz erzeugt. Die PDF-/DOCX-Dateien bleiben die
> unveränderten Referenzdokumente. Bei Konvertierungsabweichungen gilt die freigegebene Binärfassung.

LASTENHEFT
Rundflug-Leitstand
Webbasiertes Operations-Management-System für Rundflüge auf Flugplatzfesten und Fly-Ins
| Angabe | Wert |
| --- | --- |
| Dokumenttyp | Lastenheft (Anforderungen des Auftraggebers) |
| Projekt | Rundflug-Leitstand / Rundflug-Management-System (RMS) |
| Version | 1.4 - Konsolidierte Fassung |
| Datum | 10.07.2026 |
| Status | Konsolidierter Entwurf zur fachlichen Freigabe |
| Basis | Fachkonzept des Auftraggebers; Lastenheft v1.3; Präsentationsentwurf |
| Ursprungsautor v1.3 | Dr. Julian Kehrle |
| Konsolidierung | [Projektteam / Verein eintragen] |
| Auftraggeber | [Veranstalter / Verein eintragen] |
| Auftragnehmer | [wird im Vergabeverfahren bestimmt] |

Dieses Lastenheft beschreibt, WAS die Software leisten soll. Die technische Umsetzung (WIE) ist Gegenstand des Pflichtenhefts.
Dokumentenhistorie
| Version / Datum | Änderung |
| --- | --- |
| 0.1 / 05.07.2026 | Erstentwurf auf Basis des Fachkonzepts des Auftraggebers. |
| 0.2-1.3 / 08.-09.07.2026 | Operative Ausarbeitung mit Slotbildung, Cloudbetrieb, No-Show- und Gruppenschutz, Masken, Rollen, Datenschutz, Not-Halt, Roadmap und Abnahmeszenario. |
| 1.4 / 10.07.2026 | Konsolidierung beider Ansätze: Trennung Produkt/Ressourcengruppe/Flugzeug, harte Zuordnungsinvariante, ereignisbasierte Zustandsableitung, Plan-/Prognose-/Ist-Zeiten, dynamische Mehrflugzeug-Disposition, öffentliche Zeitfenster statt Scheingenauigkeit sowie vier Primäraktionen mit separatem Abschlussereignis. |

Konsolidierte Leitentscheidungen
| Thema | Konsolidierte Festlegung |
| --- | --- |
| Fachliches Kernmodell | Produkt -> Ressourcengruppe -> Flugzeug. Mehrere Produkte dürfen dieselbe operative Kapazität nutzen. |
| Queue und Slot | Eine operative Queue je Ressourcengruppe; stabile Fluggruppen-/Slotnummern je Produkt als Kommunikationsobjekt, nicht als feste Uhrzeit. |
| Zeitmodell | Intern konkrete Prognosezeitpunkte plus Unsicherheit; öffentlich Countdown oder Zeitfenster, keine einzelne Uhrzeit als Zusage. |
| Bedienung Flight Line | Vier Primäraktionen: NEXT, IM FLUG, GELANDET, ABGESCHLOSSEN/VERFÜGBAR. Optionaler Check-in per Scan. |
| Automatisierung | Vor NEXT automatische Optimierung; ab NEXT nur Vorschläge und menschliche Bestätigung. Gruppen werden nie automatisch getrennt. |
| Prognose | Reale Ereignisse wirken stärker als Planwerte; alle Folgeflüge werden nach relevanten Ereignissen neu disponiert. |
| Sitzplatzkapazität | Aus der aktiven Flotte der Ressourcengruppe abgeleitete Kapazitätsspanne; konkrete Flugzeugkapazität ist für den Umlauf maßgeblich. |
| Ticketbereitstellung | V1 unterstützt vorgedruckte QR-Tickets und druckbare/digitale Tickets; spezielle Bondrucker-Anbindung folgt in V2. |
| Betriebsarchitektur | Zentrale EU-Cloud-PWA mit Offline-Queue für kurze Ausfälle; Papier-Rückfallebene für Totalausfall. |
| Datenschutz | Keine Gastnamen im Kernsystem; ein optionales Passagierlistenmodul bleibt strikt getrennt. |

Anforderungsumfang
| Kategorie | Anzahl | Bedeutung |
| --- | --- | --- |
| Gesamt | 199 | Eindeutige, prüfbare Anforderungs-IDs |
| MUSS | 158 | Abnahmerelevant in der jeweiligen Stufe |
| SOLL | 29 | Abweichung nur begründet und abgestimmt |
| KANN | 12 | Option nach Aufwand-Nutzen-Abwägung |
| V1 | 176 | Produktiver Kernbetrieb |
| V2-V4 | 23 | Optionale Ausbaustufen |

Inhaltsverzeichnis
| 1 Einleitung und Zielbild | 5 |
| --- | --- |
| 1.1 Ausgangslage | 5 |
| 1.2 Zielsetzung | 5 |
| 1.3 Systemcharakter und Leitprinzipien | 5 |
| 1.4 Abgrenzung und Nicht-Ziele | 5 |
| 1.5 Konsolidierungsentscheidungen | 5 |
| 1.6 Verbindlichkeit, Priorisierung und Ausbaustufen | 6 |
| 2 Produkteinsatz und Rollen | 6 |
| 2.1 Anwendungsbereich und Betriebsumgebung | 6 |
| 2.2 Rollen und Berechtigungen | 6 |
| 2.3 Geräte und Arbeitsplätze | 6 |
| 2.4 Besondere Betriebsbedingungen | 7 |
| 3 Fachliches Domänenmodell | 7 |
| 3.1 Produkt, Ressourcengruppe und Flugzeug | 7 |
| 3.2 Tickets, Gruppen, Fluggruppen und Umläufe | 7 |
| 3.3 Warteschlange und Dispositionsregeln | 7 |
| 3.4 Zentrale fachliche Invarianten | 8 |
| 4 Ereignis-, Zeit- und Statusmodell | 8 |
| 4.1 Ereignisbasiertes Grundprinzip | 8 |
| 4.2 Planzeit, Prognosezeit und Ist-Zeit | 8 |
| 4.3 Ticket- und Besucherstatus | 8 |
| 4.4 Flug-, Flugzeug- und Ressourcenstatus | 9 |
| 4.5 Korrekturen und manuelle Eingriffe | 9 |
| 5 Prozessbeschreibungen | 9 |
| 5.1 Ticketverkauf | 9 |
| 5.2 Queue- und Fluggruppenbildung | 9 |
| 5.3 Standardumlauf an der Flight Line | 9 |
| 5.4 No-Show, Nachbesetzung und Gruppenschutz | 10 |
| 5.5 Maschinenausfall, Pause, Tanken und Wetter | 10 |
| 5.6 Notfallmodus | 10 |
| 5.7 Tagesabschluss | 10 |
| 6 Prognose- und Dispositionsmodell | 10 |
| 6.1 Prognosegegenstand und Eingangsgrößen | 10 |
| 6.2 Messwerte, Startwerte und Gewichtung | 10 |
| 6.3 Disposition mehrerer Flugzeuge | 11 |
| 6.4 Unsicherheit und öffentliche Kommunikation | 11 |
| 6.5 Verzögerungserkennung und Kapazität | 11 |
| 7 Bedien- und Anzeigekonzept | 11 |
| 7.1 Kasse | 11 |
| 7.2 Flight Line / Boarding | 11 |
| 7.3 Flugleitung und Administration | 11 |
| 7.4 Besucherstatus und Benachrichtigung | 11 |
| 7.5 FIDS- und Boardingmonitore | 12 |
| 8 Funktionale Anforderungen | 12 |
| 8.1 Ticketverkauf (Kasse) | 12 |
| 8.2 Produkte, Ressourcengruppen und Flugzeuge | 13 |
| 8.3 Fluggruppen, Slots und Warteschlangen | 13 |
| 8.4 Ereignisse und Flight-Line-/Boarding-Ablauf | 14 |
| 8.5 Flotte, Piloten, Pausen und Tanken | 15 |
| 8.6 Prognose, Disposition und Kapazität | 15 |
| 8.7 Wetter, Betriebsunterbrechung und Notfallmodus | 16 |
| 8.8 Besucher-, FIDS- und Boardinganzeigen | 16 |
| 8.9 Gastinformation und Benachrichtigung | 17 |
| 8.10 Historie, Protokoll und Auswertung | 17 |
| 8.11 Administration und Geräteverwaltung | 18 |
| 8.12 Schnittstellen und spätere Erweiterungen | 18 |
| 9 Datenanforderungen | 18 |
| 10 Nichtfunktionale Anforderungen | 19 |
| 10.1 Bedienbarkeit und Oberfläche | 19 |
| 10.2 Zuverlässigkeit und Verbindungsverhalten | 20 |
| 10.3 Performance und Mengengerüst | 20 |
| 10.4 Sicherheit, Datenschutz und Zugriffsschutz | 20 |
| 10.5 Wartbarkeit, Erweiterbarkeit und Betriebskosten | 20 |
| 11 Technische Rahmenbedingungen | 21 |
| 12 Ausbaustufen (Roadmap) | 21 |
| 13 Lieferumfang und Abnahme | 22 |
| 13.1 Lieferumfang | 22 |
| 13.2 Abnahmeszenario V1 | 22 |
| 13.3 Messbare Abnahmekriterien | 22 |
| 14 Glossar | 23 |
| Anhang A Konsolidierungs- und Entscheidungsmatrix | 23 |

# 1 Einleitung und Zielbild

## 1.1 Ausgangslage

Rundflüge sind auf Flugplatzfesten und Fly-Ins ein zentraler Programmpunkt und häufig eine wesentliche Einnahmequelle. Die Abwicklung erfolgt heute vielfach mit Papierlisten, Zurufen und Erfahrungswissen einzelner Helfer. Daraus entstehen intransparente Wartezeiten, unnötige Aufenthalte an der Flight Line, ungleichmäßige Auslastung, hoher Koordinationsaufwand und fehlende Nachvollziehbarkeit.
Beschafft beziehungsweise entwickelt werden soll eine webbasierte Software, die den organisatorischen Ablauf vom Ticketverkauf bis zum abgeschlossenen Rundflug live unterstützt. Sie arbeitet wie ein auf Rundflugbetrieb zugeschnittenes Operations-Management-System mit Elementen aus Ticketing, Queue Management, Ressourcendisposition und Flughafen-Informationsanzeige.
## 1.2 Zielsetzung

- Wartezeiten für Gäste reduzieren und transparent kommunizieren.
- Gäste erst dann zur Flight Line holen, wenn ihre Anwesenheit operativ erforderlich ist.
- Flugzeuge und verfügbare Kapazität möglichst gleichmäßig und konfliktfrei auslasten.
- Kasse, Flight Line, Flugleitung und Besucher jederzeit mit demselben Livezustand versorgen.
- Verzögerungen automatisch erkennen und alle abhängigen Prognosen dynamisch aktualisieren.
- Ehrenamtliche Helfer durch wenige, eindeutige Aktionen entlasten.
- Alle Vorgänge und Prognosen für Nachbereitung, Statistik und Verbesserung nachvollziehbar speichern.
## 1.3 Systemcharakter und Leitprinzipien

| Leitsatz Die Kasse verwaltet die Nachfrage. Die Flight Line verwaltet die Realität. Das System verbindet beides durch eine fortlaufend aktualisierte Prognose. |
| --- |

- Ereignisse statt manueller Zeitpflege: Helfer erfassen reale Vorgänge; Zeiten und Folgeeffekte berechnet das System.
- Stabile Kommunikation, flexible Disposition: Fluggruppen-/Slotnummern bleiben sichtbar, Flugzeug und konkrete Zeiten bleiben bis möglichst spät disponierbar.
- Messen statt starr planen: Planwerte starten die Prognose; reale Tageswerte gewinnen rasch an Gewicht.
- Vorschlagen statt übersteuern: Automatik optimiert vor dem Aufruf. Danach entscheidet das Personal über Änderungen.
- Ehrliche Zeitfenster statt Scheingenauigkeit: intern präzise Rechenwerte, öffentlich verständliche Intervalle.
- Keine Sicherheitsfreigaben: Die Software unterstützt Organisation, nicht flugbetriebliche oder luftrechtliche Entscheidungen.
## 1.4 Abgrenzung und Nicht-Ziele

- Keine Flugplanung, Wetterentscheidung, Startfreigabe oder sonstige luftrechtliche Funktion.
- Keine Entscheidung über Beladung, Schwerpunkt, Flugtauglichkeit oder Durchführung. Solche Entscheidungen verbleiben ausschließlich bei Pilot und Flugleitung.
- Keine elektronische Registrierkasse im Sinne steuerrechtlicher Vorgaben; Zahlungen werden nur informatorisch erfasst.
- Keine Verwaltung von Pilotenlizenzen, Flugbüchern oder Wartungsunterlagen.
- Keine Pflicht zur Erfassung von Gastnamen. Optionale spätere Passagierlisten sind ein getrenntes Modul.
- Keine native App als Voraussetzung. Gäste und Helfer nutzen eine Webanwendung beziehungsweise PWA.
## 1.5 Konsolidierungsentscheidungen

Die Fassung 1.4 verbindet die operative Einfachheit des Lastenhefts v1.3 mit dem flexibleren Ressourcen- und Prognosemodell des ursprünglichen Fachkonzepts. Die wesentlichen Konflikte werden wie folgt aufgelöst:
| Spannungsfeld | Konsolidierte Entscheidung |
| --- | --- |
| Kategorie oder Ressourcenmodell | Kategorie wird fachlich durch Produkt und Ressourcengruppe ersetzt. Eine optionale Produktkategorie bleibt reine Darstellung. |
| Keine Uhrzeiten oder FIDS-Prognose | Intern konkrete Prognosezeiten; extern Countdown oder Zeitfenster. Damit bleibt das System rechenfähig, ohne feste Zusagen zu erzeugen. |
| Vier Taps oder mehr Messpunkte | Vier Primäraktionen erzeugen mehrere fachliche Ereignisse. Optionaler Check-in bleibt außerhalb des Minimalpfads. |
| Feste Slots oder dynamische Planung | Fluggruppe/Slot ist eine stabile Passagierkohorte und Kommunikationsnummer, keine feste Zeit oder Maschine. |
| Homogene oder gemischte Flotte | Die aktive Flotte liefert die Kapazitätsspanne; die konkrete Maschinenkapazität entscheidet beim Umlauf. |
| Vorgedrucktes oder gedrucktes Ticket | Beide Ausgabearten werden in V1 unterstützt; spezifische Bondrucker-Integration folgt später. |

## 1.6 Verbindlichkeit, Priorisierung und Ausbaustufen

Jede Anforderung besitzt eine eindeutige ID, Priorität und Ausbaustufe. Für die Abnahme einer Stufe sind die dort gekennzeichneten MUSS-Anforderungen maßgeblich.
| Priorität | Bedeutung |
| --- | --- |
| MUSS | Zwingend. Ohne Erfüllung wird die jeweilige Ausbaustufe nicht abgenommen. |
| SOLL | Wichtig. Abweichung nur mit schriftlicher Begründung und Zustimmung des Auftraggebers. |
| KANN | Wünschenswert. Umsetzung nach Aufwand-Nutzen-Abwägung. |

# 2 Produkteinsatz und Rollen

## 2.1 Anwendungsbereich und Betriebsumgebung

Die Software wird bei ein- bis mehrtägigen Flugveranstaltungen auf Flugplätzen ohne feste IT-Infrastruktur eingesetzt. Typische Rahmendaten je Veranstaltungstag sind zwei bis sechs aktive Flugzeuge, ein bis fünf Produkte, 50 bis 400 verkaufte Tickets, 30 bis 120 Umläufe und fünf bis 20 gleichzeitig verbundene Geräte. Der Betrieb findet teilweise im Freien, bei Sonne, Lärm und wechselnden Lichtverhältnissen statt.
## 2.2 Rollen und Berechtigungen

| Rolle | Aufgaben und Berechtigungen |
| --- | --- |
| Administrator | Event einrichten, Stammdaten und Ressourcengruppen pflegen, Geräte koppeln, Prognoseparameter verwalten, Vollzugriff und Aufhebung des Notfallmodus. |
| Kassenpersonal | Tickets verkaufen, optionale Angaben erfassen, Storno/Umbuchung/Klärung durchführen, aktuelle Prognose und Verkaufsempfehlung sehen. Keine Flugzeug- oder Pilotenzuordnung. |
| Leiter Flight Line | Operative Queue überwachen, Systemvorschläge bestätigen oder anpassen, Ressourcenstatus setzen, Sonderfälle und Notfallmodus steuern. |
| Flight-Line-/Boardingpersonal | NEXT, Check-in, IM FLUG, GELANDET, ABGESCHLOSSEN sowie Zurückstellung und No-Show im Standardbetrieb. |
| Flugleitung | Primär lesendes Dashboard mit Gesamtüberblick; Not-Halt erreichbar. Keine operative Detailbedienung, soweit nicht ausdrücklich freigegeben. |
| Monitor | Kioskrolle ohne Bedienfunktion für FIDS- und Boardinganzeigen. |
| Besucher | Keine interne Systemrolle. Zugriff auf eigene Status-Seite über nicht erratbaren QR-Code. |

## 2.3 Geräte und Arbeitsplätze

- Ein bis zwei Tablets an der Kasse.
- Ein bis zwei Tablets je Flight Line beziehungsweise Boardingposition.
- Ein Administrationsgerät und optional ein Gerät der Flugleitung.
- Ein oder mehrere große Monitore mit Kiosk-Abspielgerät.
- Smartphones der Gäste über eine öffentliche Status-Seite; keine App-Installation erforderlich.
## 2.4 Besondere Betriebsbedingungen

- Helfer können stündlich wechseln und erhalten höchstens zehn Minuten Einweisung.
- Bedienung erfolgt im Stehen, unter Zeitdruck und teilweise mit eingeschränkter Sichtbarkeit.
- Eine eingewiesene Person muss Router, Tablets und Monitore in höchstens 30 Minuten betriebsbereit aufbauen können.
- Kurze Mobilfunkausfälle dürfen den Arbeitsfluss nicht unterbrechen; für Totalausfall existiert eine Papier-Rückfallebene.
# 3 Fachliches Domänenmodell

## 3.1 Produkt, Ressourcengruppe und Flugzeug

Die fachliche Trennung dieser drei Ebenen ist verbindlich. Sie ermöglicht, mehrere buchbare Angebote auf einer gemeinsamen Flotte zu betreiben, ohne widersprüchliche Queues oder Doppelbelegungen zu erzeugen.
| Ebene | Bedeutung | Beispiel |
| --- | --- | --- |
| Produkt | Buchbares Angebot mit Preis, Darstellung und Leistungsprofil. Verwendet genau eine Ressourcengruppe. | Standard-Rundflug, Oldtimer-Rundflug, Motorsegler |
| Ressourcengruppe | Operative Kapazität mit eigener Queue und Dispositionslogik. Enthält ein oder mehrere aktive Flugzeuge. | Standard-Flugzeuge |
| Flugzeug | Konkretes Luftfahrzeug mit Kennzeichen, Kapazität, Status und Pilot. | D-EABC, D-EFGH |

| Harte Invariante Ein Flugzeug darf zu einem Zeitpunkt nur einer aktiven Ressourcengruppe angehören. Diese Regel wird technisch erzwungen und verhindert konkurrierende Warteschlangen. |
| --- |

## 3.2 Tickets, Gruppen, Fluggruppen und Umläufe

| Objekt | Fachliche Bedeutung |
| --- | --- |
| Ticket | Berechtigung einer Person für ein Produkt; trägt QR-Code und Status. |
| Buchungsgruppe | Gemeinsam verkaufte Tickets mit Gruppenbindung. |
| Fluggruppe / Slot | Stabile, öffentlich kommunizierbare Passagierkohorte eines Produkts. Noch keine feste Maschine und keine feste Uhrzeit. |
| Flug / Umlauf / Rotation | Konkreter operativer Vorgang mit Flugzeug, Pilot, Gate, Ereignissen und Ist-Zeiten. |

| Verkauf Nachfrage | > | Queue Ressourcengruppe | > | Slot Fluggruppe | > | NEXT operativer Aufruf | > | Umlauf Flugzeug + Pilot | > | Abschluss Ist-Daten |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

## 3.3 Warteschlange und Dispositionsregeln

Jede Ressourcengruppe besitzt eine operative Queue. Tickets bleiben ihrem Produkt zugeordnet, werden aber innerhalb der gemeinsamen Kapazität disponiert. In V1 gilt grundsätzlich First sold, first served über Produktgrenzen hinweg, ergänzt um Gruppenbindung, Passfähigkeit, Standby und bestätigte Sonderregeln.
- Vor NEXT darf das System Fluggruppen automatisch bilden, Lücken schließen und noch ungebundene Gruppen einem anderen kompatiblen Flugzeug vorschlagen.
- Ab NEXT werden keine Passagiere stillschweigend umgebucht; das System macht nur noch Vorschläge.
- Eine Fluggruppen-/Slotnummer bleibt als Kommunikationskennung stabil, auch wenn das konkrete Flugzeug wechselt.
- Die konkrete Flugzeugzuordnung erfolgt so spät wie betrieblich sinnvoll.
## 3.4 Zentrale fachliche Invarianten

1. Ein Flugzeug gehört höchstens einer aktiven Ressourcengruppe an.
2. Ein Ticket gehört höchstens einem nicht abgeschlossenen Umlauf an.
3. Ein Pilot führt höchstens einen Umlauf gleichzeitig in Boarding, Bereit oder Im Flug.
4. Eine Fluggruppenbesetzung ist nach IM FLUG unveränderlich.
5. Gruppen werden nach dem Aufruf niemals automatisch getrennt.
6. Öffentliche Anzeigen enthalten keine Gastnamen.
7. Sicherheitsrelevante Entscheidungen bleiben beim Piloten beziehungsweise der Flugleitung.
# 4 Ereignis-, Zeit- und Statusmodell

## 4.1 Ereignisbasiertes Grundprinzip

Die operative Wahrheit entsteht aus Ereignissen. Helfer erfassen, was tatsächlich passiert ist; das System leitet daraus Zustände, Prognosen, Kapazität und Anzeigen ab. Historische Ereignisse werden nicht überschrieben. Fehleingaben werden durch Rücknahme- oder Korrekturereignisse nachvollziehbar berichtigt.
| Primäraktion | Abgeleitete fachliche Ereignisse |
| --- | --- |
| NEXT | Fluggruppe aufgerufen; Boarding begonnen; Benachrichtigung ausgelöst; Prognose neu gerechnet. |
| IM FLUG | Boarding abgeschlossen; Start/Abrollen erfasst; Besetzung fixiert. |
| GELANDET | Landung/Zurückrollen erfasst; Flugzeit beendet; Deboarding begonnen. |
| ABGESCHLOSSEN | Passagiere ausgestiegen; Umlauf beendet; Flugzeug verfügbar; Folgeprognose aktualisiert. |

## 4.2 Planzeit, Prognosezeit und Ist-Zeit

| Zeitart | Bedeutung | Verwendung |
| --- | --- | --- |
| Planzeit | Aus Stammdaten oder Verkaufszeitpunkt abgeleiteter Referenzwert. | Startwert, Vergleich und ursprüngliche Erwartung. |
| Prognosezeit | Aktuell erwarteter Zeitpunkt auf Basis von Queue, Ressourcen und gemessenen Ereignissen. | Operative Disposition und interne Anzeige. |
| Ist-Zeit | Tatsächlich erfasster Zeitpunkt eines Ereignisses. | Quelle für Status, Lernen, Statistik und Nachweis. |

Das System darf intern minutengenaue Prognosewerte berechnen. Gäste erhalten daraus eine robuste Zeitspanne oder einen Countdown. Eine einzelne Prognoseuhrzeit ist ausdrücklich keine feste Zusage.
## 4.3 Ticket- und Besucherstatus

| Interner Status | Öffentliche Darstellung / Handlung |
| --- | --- |
| Verkauft / Wartend | Warten - noch nicht zur Flight Line kommen. |
| Voraufruf | Bitte zum Gate / GO TO GATE - Ticket bereithalten. |
| Aufgerufen / Boarding | Bitte jetzt zur Flight Line / Boarding. |
| Eingecheckt | An der Flight Line registriert. |
| Im Flug | Flug läuft. |
| Gelandet / Deboarding | Gelandet - Ausstieg läuft. |
| Abgeschlossen | Rundflug abgeschlossen. |
| Zurückgestellt / No-Show / Klärung | Bitte an Kasse oder Personal wenden; keine interne Detailbegründung öffentlich. |

## 4.4 Flug-, Flugzeug- und Ressourcenstatus

Umlauf, Flugzeug und Ressourcengruppe besitzen getrennte Statusautomaten. Dadurch kann beispielsweise ein gelandeter Umlauf noch im Deboarding sein, während die Ressourcengruppe insgesamt weiterarbeitet und ein anderes Flugzeug bereits den nächsten Slot übernimmt.
| Objekt | Mindestens erforderliche Zustände |
| --- | --- |
| Umlauf | Vorgemerkt, Aufgerufen/Boarding, Bereit, Im Flug, Gelandet/Deboarding, Abgeschlossen, Abgebrochen. |
| Flugzeug | Verfügbar, Boarding, Im Flug, Gelandet/Deboarding, Tanken, Pause, unterbrochen, inaktiv. |
| Ressourcengruppe | Aktiv, pausiert, unterbrochen, beendet. |

## 4.5 Korrekturen und manuelle Eingriffe

Manuelle Eingriffe erfassen reale betriebliche Zustände und keine willkürlichen Folgezeiten. Zulässige Eingriffe sind insbesondere Flugzeug blockieren, Tanken, Pilotenpause, Ressourcengruppe pausieren, Flug abbrechen, Ticket zurückstellen, Slot teilen oder Zuordnung ändern. Das direkte Überschreiben einer prognostizierten Startzeit ist kein Regelprozess.
# 5 Prozessbeschreibungen

## 5.1 Ticketverkauf

| Produkt antippen | > | Personen Gruppe bilden | > | Optionen nur falls nötig | > | QR-Ticket zuordnen/ausgeben | > | Verkaufen Queue + Prognose |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

Der Standardverkauf erfolgt auf einer einzigen Kassenansicht. Die Kasse wählt Produkt und Gruppengröße, erfasst nur die für dieses Produkt aktivierten Zusatzangaben, ordnet Ticketcodes zu beziehungsweise druckt Tickets und bestätigt den Verkauf. Das System reiht die Gruppe in die Ressourcengruppen-Queue ein, bildet beziehungsweise füllt Fluggruppen und aktualisiert alle Prognosen.
## 5.2 Queue- und Fluggruppenbildung

1. Ticketgruppe in die Queue der Ressourcengruppe einreihen.
2. Produkt, Gruppenbindung und abgeleitete Kapazitätsspanne berücksichtigen.
3. Freie Plätze vor dem Aufruf mit vordersten passenden Tickets füllen; Standby kann bevorzugt werden.
4. Stabile Fluggruppen-/Slotnummer vergeben und öffentlich anzeigen.
5. Noch keine feste Maschine zusagen; konkrete Disposition aus der Ressourcenlage ableiten.
## 5.3 Standardumlauf an der Flight Line

| Schritt | Aktion des Personals | Automatische Reaktion |
| --- | --- | --- |
| 1 | NEXT an einer verfügbaren Maschine beziehungsweise auf dem vorgeschlagenen nächsten Umlauf. | Vorschlag wird übernommen; Aufruf, Boardingbeginn, Monitore und Benachrichtigung werden ausgelöst. |
| Optional | Tickets scannen oder erschienene Gäste abhaken. | Anwesenheit wird dokumentiert; fehlende Gäste werden markiert. |
| 2 | IM FLUG beim Abrollen beziehungsweise tatsächlichen Start des Umlaufs. | Besetzung wird fixiert; Boardingdauer endet; Flugzeit und Folgeprognose werden aktualisiert. |
| 3 | GELANDET beim Zurückrollen beziehungsweise nach der Landung. | Flugzeit endet; Deboarding beginnt; ETA-Abweichung fließt sofort in Folgeprognosen ein. |
| 4 | ABGESCHLOSSEN/VERFÜGBAR nach dem Ausstieg. | Umlauf- und Bodenzeit werden abgeschlossen; Maschine wird für den nächsten Vorschlag freigegeben. |

| Minimalpfad Im unveränderten Standardbetrieb sind genau vier Primäraktionen erforderlich. Flugzeug- oder Pilotwechsel, Check-in-Scans und Sonderfälle sind zusätzliche, bewusst getrennte Interaktionen. |
| --- |

## 5.4 No-Show, Nachbesetzung und Gruppenschutz

Nach NEXT verändert das System die Besetzung nicht mehr selbstständig. Bei fehlenden Gästen schlägt es die vorderste passende Nachbesetzung vor. Das Personal entscheidet zwischen Nachbesetzen, Platz leer lassen, unvollständig fliegen oder die Gruppe gemeinsam zurückstellen. Gruppen werden niemals automatisch getrennt.
## 5.5 Maschinenausfall, Pause, Tanken und Wetter

Eine Störung wird als Status beziehungsweise Blockierung erfasst. Das System nimmt die betroffene Kapazität aus der Disposition, berechnet die Verfügbarkeit der verbleibenden Flugzeuge, ordnet noch nicht aufgerufene Fluggruppen neu zu und aktualisiert Kasse, Besucheranzeigen und Prognosen. Bereits aufgerufene Gruppen werden nur nach Bestätigung verändert.
## 5.6 Notfallmodus

Der Notfallmodus stoppt Verkauf und neue Aufrufe, neutralisiert öffentliche Anzeigen und lässt die Dokumentation laufender Flüge weiter zu. Die Aufhebung ist PIN-geschützt. Der Modus trifft keine flugbetriebliche Entscheidung, sondern friert den organisatorischen Ablauf ein.
## 5.7 Tagesabschluss

- Offene Tickets und unvollständige Vorgänge prüfen.
- Veranstaltungstag operativ schließen und Verkauf sperren.
- Tagesbericht und Rohdatenexport erzeugen.
- Prognosegüte, besondere Ereignisse und Störfälle für die Nachbesprechung sichern.
- Personenbezogene Benachrichtigungsdaten nach der konfigurierten Frist automatisch löschen.
# 6 Prognose- und Dispositionsmodell

## 6.1 Prognosegegenstand und Eingangsgrößen

Das System berechnet mindestens erwartetes Boarding, Start, Landung, Abschluss, nächste Flugzeugverfügbarkeit, verbleibende Wartezeit und Restkapazität. Eingangsgrößen sind Queue, Produkte, Ressourcengruppen, Flugzeuge, Piloten, Gates, aktive Blockierungen und sämtliche gemessenen Prozessereignisse.
| Komponente | Beispielhafte Messgrenzen |
| --- | --- |
| Boardingdauer | NEXT bis IM FLUG |
| Flugzeit | IM FLUG bis GELANDET |
| Deboarding-/Bodenzeit | GELANDET bis ABGESCHLOSSEN |
| Umlaufzeit | NEXT bis ABGESCHLOSSEN |
| Verfügbarkeit | Zeitpunkt ABGESCHLOSSEN zuzüglich aktiver Puffer oder Blockierungen |

## 6.2 Messwerte, Startwerte und Gewichtung

Zu Tagesbeginn verwendet die Prognose Planwerte aus Produkt-, Ressourcen- und Flugzeugprofilen. Mit jedem validen Umlauf steigt der Einfluss realer Tagesmessungen. Das Lastenheft schreibt keine konkrete statistische Formel vor, verlangt aber ein nachvollziehbares Verfahren mit Kaltstart, stärkerer Gewichtung realer Ereignisse, Ausreißerbehandlung und Unsicherheitsangabe.
| Ergebnis statt Scheingenauigkeit Ein intern berechneter Startwert von 14:36 Uhr kann öffentlich als „voraussichtlich 14:30 bis 14:45 Uhr“ oder „in etwa 20 bis 30 Minuten“ erscheinen. |
| --- |

## 6.3 Disposition mehrerer Flugzeuge

Für jedes Flugzeug wird der frühestmögliche nächste Verfügbarkeitszeitpunkt berechnet. Offene Fluggruppen werden in Queue-Reihenfolge dem jeweils frühest verfügbaren kompatiblen Flugzeug vorgeschlagen. Das System darf eine bereits prognostizierte, aber noch nicht aufgerufene Fluggruppe auf ein anderes Flugzeug verschieben, wenn dadurch der Gesamtbetrieb verbessert wird und alle Invarianten gewahrt bleiben.
Nutzen mehrere Produkte dieselbe Ressourcengruppe, werden ihre Fluggruppen gemeinsam disponiert. Produktdauer und Kompatibilität können unterschiedlich sein. Die öffentliche Produkt- und Fluggruppenkennung bleibt unabhängig von der konkreten Maschinenwahl bestehen.
## 6.4 Unsicherheit und öffentliche Kommunikation

- Nahe Fluggruppen erhalten engere, entfernte Fluggruppen breitere Zeitfenster.
- Bei wenig Daten, Wetterunterbrechung oder unklarer Ressourcensituation wird die Prognosequalität sichtbar herabgestuft.
- Interne Rollen dürfen konkrete Rechenzeitpunkte sehen; öffentlich steht die Handlungsempfehlung im Vordergrund.
- Der Zeitpunkt der letzten Aktualisierung ist auf der Status-Seite sichtbar.
## 6.5 Verzögerungserkennung und Kapazität

Bleibt ein erwartetes Ereignis aus oder dauert eine Prozessphase länger als prognostiziert, erkennt das System die Abweichung automatisch. Es aktualisiert die laufende ETA, die nächste Verfügbarkeit des Flugzeugs, alle abhängigen Boarding- und Startprognosen sowie die verkaufbare Restkapazität. Eine manuelle Korrektur jedes einzelnen Folgeflugs ist ausgeschlossen.
# 7 Bedien- und Anzeigekonzept

## 7.1 Kasse

- Ein Bildschirm ohne Menünavigation im Regelfall.
- Große Produktkacheln mit Preis, Wartezeitspanne, Prognosefenster, Restkapazität und Verkaufsempfehlung.
- Nur produktabhängig erforderliche Angaben werden eingeblendet.
- Storno, Suche und Tagesbericht als klar getrennte Sekundärfunktionen.
## 7.2 Flight Line / Boarding

- Supervisor-Ansicht am Desktop mit Arbeitsliste, Queue, Prognosen und Live-Flottenstatus.
- Separate Flight-Line-Assistenz für Tablet und Mobiltelefon mit je Flugzeug genau den nächsten
  sinnvollen Primäraktionen und anonymer kurzzeitiger Betreuungsreservierung.
- Vier Primäraktionen im Standardumlauf; Sonderfälle über kurze kontextbezogene Dialoge.
- Fehlende Passagiere, Gruppenschutz und Nachbesetzung als bestätigungspflichtige Vorschläge.
- Not-Halt jederzeit sichtbar, aber gegen versehentliche Aufhebung geschützt.
## 7.3 Flugleitung und Administration

- Gesamtübersicht über Queues, laufende Flüge, Ressourcen, Blockierungen und Prognosen in der
  Flight-Line-Supervisor-Ansicht.
- Flugleitung primär lesend; Administration konfigurierend.
- Die Administration verwendet kompakte Tabellen. Editoren öffnen nur nach „Neu“ oder „Bearbeiten“.
- Änderungen von Stammdaten und Ressourcenzuordnungen zeigen vorab ihre betrieblichen Auswirkungen.
## 7.4 Besucherstatus und Benachrichtigung

Die Besucheransicht beantwortet nur vier Fragen: Was habe ich gebucht? Wie ist mein aktueller Status? Wie lange dauert es voraussichtlich noch? Was soll ich jetzt tun? Interne Dispositionsdetails, Piloteninformationen und personenbezogene Daten anderer Gäste werden nicht angezeigt.
## 7.5 FIDS- und Boardingmonitore

| Anzeige | Kerninhalt |
| --- | --- |
| Fluggastmonitor / FIDS | Konfigurierbares Standardprofil sowie vollständig englisches Terminalprofil mit WAITING, GO TO GATE, BOARDING, DELAYED und DEPARTED; nächste Fluggruppen, Produkt, Gate und Zeitfenster/Countdown. |
| Boardingmonitor | Kommende Fluggruppen, Ticketnummern, vorgeschlagene beziehungsweise zugeordnete Maschine, Gate und Flottenstatus. |

# 8 Funktionale Anforderungen

## 8.1 Ticketverkauf (Kasse)

| ID | Anforderung | Priorität | Stufe |
| --- | --- | --- | --- |
| F-KAS-010 | Das Kassenpersonal muss einen Standardverkauf für eine Gruppe in maximal sechs Interaktionen und in der Regel in weniger als 15 Sekunden abschließen können. Freiwillige Zusatzangaben und Sonderfälle sind von dieser Zielzeit ausgenommen. | MUSS | V1 |
| F-KAS-020 | Zusammen verkaufte Tickets erhalten automatisch eine gemeinsame Gruppen-ID. Gruppenbindungen werden in allen Folgeprozessen berücksichtigt. | MUSS | V1 |
| F-KAS-030 | Gewichtsklassen (Kind, Normal, Schwer, Individuell mit kg-Angabe) müssen je Produkt oder Veranstaltung konfigurierbar aktivierbar sein. Ist die Funktion aktiv, ist je Person eine Klasse zu erfassen; ist sie deaktiviert, darf sie den Verkaufsablauf nicht verlängern. | MUSS | V1 |
| F-KAS-040 | Im Ticketkern werden weder Namen noch Telefonnummern erfasst. Optional sind ausschließlich anonyme ticketbezogene Merkmale wie Standby und erforderliche Produktoptionen; Web-Push wird getrennt und freiwillig je Ticket registriert. | MUSS | V1 |
| F-KAS-050 | Jedes Ticket erhält eine eindeutige, nicht erratbare Ticketnummer mit QR-Code. V1 unterstützt sowohl vorgedruckte Ticketcodes als auch die Ausgabe eines druckbaren oder digitalen Tickets aus dem System. | MUSS | V1 |
| F-KAS-055 | Eine gerätespezifische Bondrucker-Anbindung zur direkten Ticketausgabe ist vorzusehen. | SOLL | V2 |
| F-KAS-060 | Bezahlstatus und Zahlart werden nicht erfasst. Der Produktpreis wird ausschließlich als Produkt- und Abstimmungsinformation angezeigt; das System ist keine elektronische Registrierkasse und wickelt keine Zahlung ab. | MUSS | V1 |
| F-KAS-070 | Storno ist nur für Kasse und Administrator zulässig, erfordert einen Grund und erzeugt einen unveränderlichen Protokolleintrag. | MUSS | V1 |
| F-KAS-080 | Umbuchung eines Tickets auf ein anderes Produkt muss mit korrekter Neueinreihung in die operative Warteschlange und vollständiger Protokollierung möglich sein. | MUSS | V1 |
| F-KAS-090 | Ticketsuche nach Ticketnummer, Gruppen-ID, Fluggruppen-/Slotnummer und QR-Code. | MUSS | V1 |
| F-KAS-100 | Die Verkaufskachel zeigt je Produkt mindestens: Betriebsstatus, realistische Wartezeitspanne, prognostiziertes Aufruf-/Boardingfenster, Kapazitätsampel und realistisch verbleibende verkaufbare Plätze. | MUSS | V1 |
| F-KAS-110 | Ist für ein Produkt eine Begleitpflicht für Kinder hinterlegt, weist das System bei einer Kinderbuchung ohne erwachsene Begleitung in derselben Gruppe deutlich darauf hin. | SOLL | V1 |
| F-KAS-120 | Der Verkauf wird technisch gesperrt, wenn das Produkt oder seine Ressourcengruppe nicht verkaufbar ist, der Verkaufsschluss erreicht ist oder der Notfallmodus aktiv ist. Der Sperrgrund wird angezeigt. | MUSS | V1 |
| F-KAS-130 | Tageszählbericht als Abstimmhilfe mit verkauften Tickets und Stornos je Produkt. Zahlarten, Bezahlstatus und Zahlungsabwicklung sind ausgeschlossen. | MUSS | V1 |
| F-KAS-140 | Gutschein-Tickets können ohne sofortige Einreihung ausgegeben und später an der Kasse eingelöst werden. | KANN | V2 |
| F-KAS-150 | Warteliste je Produkt für ausverkaufte oder gesperrte Angebote; Vormerkung ohne Zahlung und geregeltes Nachrücken bei frei werdender Kapazität. | KANN | V2 |
| F-KAS-160 | Die Kasse verkauft ausschließlich auf Basis der aktuellen Betriebs- und Prognoselage. Eine feste Flugzeug- oder Pilotenzuordnung durch die Kasse ist ausgeschlossen. | MUSS | V1 |

## 8.2 Produkte, Ressourcengruppen und Flugzeuge

| ID | Anforderung | Priorität | Stufe |
| --- | --- | --- | --- |
| F-RES-010 | Jedes buchbare Produkt verwendet genau eine Ressourcengruppe. Produktmerkmale wie Bezeichnung, Preis, Referenzdauer, öffentliche Darstellung und Verkaufsregeln sind von der Ressourcengruppe getrennt zu führen. | MUSS | V1 |
| F-RES-020 | Mehrere Produkte dürfen dieselbe Ressourcengruppe verwenden. Deren Nachfrage wird in einer gemeinsamen operativen Kapazität disponiert. | MUSS | V1 |
| F-RES-030 | Eine Ressourcengruppe kann ein oder mehrere Flugzeuge enthalten. Standardmäßig besitzt jedes Flugzeug eine eigene Ressourcengruppe; die Zusammenfassung mehrerer Flugzeuge ist konfigurierbar. | MUSS | V1 |
| F-RES-040 | Ein Flugzeug darf zu jedem Zeitpunkt höchstens einer aktiven Ressourcengruppe zugeordnet sein. Das System muss widersprüchliche Zuordnungen technisch verhindern. | MUSS | V1 |
| F-RES-050 | Zuordnungen von Flugzeugen zu Ressourcengruppen besitzen Gültigkeitszeiträume und werden historisiert. Änderungen im laufenden Betrieb werden mit Auswirkungen auf Queue und Prognose sofort verarbeitet. | MUSS | V1 |
| F-RES-060 | Ein Produkt verwendet genau eine Ressourcengruppe. Flugzeugkompatibilität und Passagierkapazität werden aus den konkret aktiv zugeordneten Flugzeugen abgeleitet; gepflegt werden Gate und planmäßige Prozessdauern, keine Freitext-Typenlisten oder manuelle Gruppenkapazität. | MUSS | V1 |
| F-RES-070 | Ressourcengruppen besitzen einen eigenen Betriebsstatus: aktiv, pausiert, unterbrochen oder beendet. Der Status wirkt auf Verkauf, Aufruf, Prognose und Anzeigen. | MUSS | V1 |
| F-RES-080 | Die operative Queue wird je Ressourcengruppe geführt. Produktzugehörigkeit und stabile öffentliche Fluggruppen-/Slotnummern bleiben dabei erhalten. | MUSS | V1 |
| F-RES-090 | Flugzeuge mit abweichender Sitzplatzkapazität dürfen in einer Ressourcengruppe betrieben werden, sofern die konkrete Kapazität beim Umlauf berücksichtigt wird. V1 darf hierfür einen bestätigungspflichtigen Vorschlag statt vollautomatischer Optimierung verwenden. | SOLL | V1 |
| F-RES-100 | Eine temporäre Umgruppierung eines Flugzeugs im laufenden Betrieb ist nur durch Leiter Flight Line oder Administrator zulässig, zeigt die prognostizierten Auswirkungen vor Bestätigung und wird protokolliert. | SOLL | V2 |

## 8.3 Fluggruppen, Slots und Warteschlangen

| ID | Anforderung | Priorität | Stufe |
| --- | --- | --- | --- |
| F-SLT-010 | Das System bildet aus verkauften Tickets stabile Fluggruppen/Slots je Produkt. Die operative Reihenfolge wird innerhalb der zugehörigen Ressourcengruppe geführt. Beim Verkauf erfolgt keine Flugzeugzuordnung. | MUSS | V1 |
| F-SLT-020 | Zusammen gekaufte Tickets bleiben grundsätzlich zusammen. Ist eine Gruppe größer als die verfügbare Kapazität eines einzelnen Umlaufs, wird sie nur nach ausdrücklichem Hinweis auf unmittelbar aufeinanderfolgende Fluggruppen verteilt. | MUSS | V1 |
| F-SLT-030 | Freie Plätze in noch nicht aufgerufenen Fluggruppen füllt das System automatisch mit der vordersten passenden Gruppe oder Einzelperson. Standby-Tickets dürfen bevorzugt werden. Ab dem Aufruf erfolgen Änderungen nur noch als bestätigungspflichtiger Vorschlag. | MUSS | V1 |
| F-SLT-040 | Fluggruppen dürfen bis zum Statuswechsel IM FLUG geändert, ergänzt oder nachbesetzt werden. Nach IM FLUG ist die Besetzung unveränderlich; Korrekturen sind nur als dokumentierter Administrationsvorgang zulässig. | MUSS | V1 |
| F-SLT-050 | Leiter Flight Line und Flight-Line-Personal können Fluggruppen manuell anpassen. Jede Abweichung vom Systemvorschlag wird protokolliert. | MUSS | V1 |
| F-SLT-060 | Die nutzbare Platzanzahl eines konkreten Umlaufs kann vor dem Aufruf reduziert werden. Nicht mitfliegende Tickets rücken unter Erhalt der Gruppenbindung an die vorderste passende Warteschlangenposition. | MUSS | V1 |
| F-SLT-070 | Fluggruppenbildung und Verkauf verwenden die aus den aktuell nutzbaren Flugzeugen der Ressourcengruppe abgeleitete Kapazitätsspanne. Maßgeblich für den konkreten Umlauf ist die Kapazität des bestätigten Flugzeugs; eine Gruppe wird nur geteilt, wenn kein nutzbares Flugzeug sie gemeinsam aufnehmen kann und die Teilung ausdrücklich bestätigt wird. | MUSS | V1 |
| F-SLT-080 | Nach jedem relevanten Ereignis berechnet das System Reihenfolge, Zuordnungen, Prognosen und Wartezeitspannen neu und verteilt den neuen Stand in Echtzeit an alle Geräte. | MUSS | V1 |
| F-SLT-090 | Fällt ein Flugzeug aus, verteilt das System noch nicht gestartete Fluggruppen auf verbleibende kompatible Flugzeuge der Ressourcengruppe neu. Bereits aufgerufene Gruppen werden nicht stillschweigend verändert. | MUSS | V1 |
| F-SLT-100 | Jede Fluggruppe erhält eine fortlaufende, gut kommunizierbare Tagesnummer in Verbindung mit dem Produktkürzel, z. B. SR-042. Diese Kennung ist auf allen Ansichten identisch. | MUSS | V1 |
| F-SLT-110 | Nutzen mehrere Produkte dieselbe Ressourcengruppe, gilt in V1 grundsätzlich die Verkaufsreihenfolge über Produktgrenzen hinweg. Konfigurierbare Produktprioritäten oder Quoten dürfen diese Regel in späteren Stufen ergänzen. | MUSS | V1 |
| F-SLT-120 | Eine noch nicht fest zugeordnete Fluggruppe wird dem frühest verfügbaren kompatiblen Flugzeug vorgeschlagen. Dabei dürfen weder Flugzeug- noch Pilotenkonflikte entstehen. | MUSS | V1 |

## 8.4 Ereignisse und Flight-Line-/Boarding-Ablauf

| ID | Anforderung | Priorität | Stufe |
| --- | --- | --- | --- |
| F-EVT-010 | Alle fachlich relevanten Änderungen werden als Ereignisse mit Zeitstempel, Quelle, Gerät, Bezug und Nutzdaten erfasst. Der operative Zustand wird aus diesen Ereignissen abgeleitet. | MUSS | V1 |
| F-EVT-020 | Ereignisse müssen idempotent verarbeitet werden. Doppel-Tipps, Wiederholungen nach Verbindungsstörungen oder parallele Eingaben dürfen keine doppelten Statuswechsel erzeugen. | MUSS | V1 |
| F-EVT-030 | Fehleingaben werden nicht durch Überschreiben historischer Zeitstempel korrigiert, sondern durch ein nachvollziehbares Korrektur- oder Rücknahmeereignis. | MUSS | V1 |
| F-EVT-040 | Das System darf aus einer Primäraktion mehrere fachliche Ereignisse ableiten, sofern diese Ableitung transparent und protokolliert ist, z. B. NEXT erzeugt Aufruf und Boardingbeginn. | MUSS | V1 |
| F-EVT-050 | Spätere automatische Quellen wie ADS-B dürfen Ereignisse vorschlagen oder plausibilisieren. Eine automatische Übernahme muss je Ereignistyp konfigurierbar sein. | SOLL | V3 |
| F-BRD-010 | Der Standardumlauf ist mit vier Primäraktionen durchführbar: NEXT, IM FLUG, GELANDET und ABGESCHLOSSEN/VERFÜGBAR. Flugzeug und Pilot werden vorgeschlagen; zusätzliche Interaktionen entstehen nur bei Abweichungen oder Sonderfällen. | MUSS | V1 |
| F-BRD-020 | NEXT übernimmt den aktuellen Vorschlag, setzt die Fluggruppe auf Bitte zur Flight Line/Boarding, startet die Boardingmessung und löst Monitore sowie Benachrichtigungen aus. | MUSS | V1 |
| F-BRD-025 | Check-in beziehungsweise Anwesenheit kann je Ticket per QR-Scan oder Antippen erfasst werden. Der Standardumlauf muss auch ohne Einzel-Scan vollständig bedienbar bleiben. | SOLL | V1 |
| F-BRD-030 | Je Flugzeug ist ein aktueller Pilot hinterlegt und wird vorgeschlagen. Ein Pilotwechsel ist mit einer zusätzlichen Interaktion möglich und wird protokolliert. | MUSS | V1 |
| F-BRD-040 | Ein Pilot darf zu keinem Zeitpunkt mehr als einen Umlauf in Boarding, Bereit oder Im Flug besitzen. Das System verhindert Konflikte technisch. | MUSS | V1 |
| F-BRD-050 | Ein Ticket darf zu keinem Zeitpunkt mehr als einem nicht abgeschlossenen Umlauf zugeordnet sein. Dies gilt auch bei paralleler Bedienung mehrerer Geräte. | MUSS | V1 |
| F-BRD-060 | Das System führt mindestens die Ticketzustände Verkauft, Wartend, Voraufruf, Bitte zur Flight Line, Eingecheckt, Boarding, Im Flug, Gelandet, Abgeschlossen, Zurückgestellt, No-Show, Klärung Kasse und Storniert. | MUSS | V1 |
| F-BRD-070 | Tickets können mit einer Interaktion zurückgestellt werden. Die Anzahl wird gezählt; nach einer konfigurierbaren Höchstzahl wechselt das Ticket in Klärung Kasse. | MUSS | V1 |
| F-BRD-080 | Erscheint ein aufgerufener Gast nicht innerhalb der konfigurierten Frist, kann das Ticket auf No-Show gesetzt werden. Das System schlägt eine Nachbesetzung vor; das Personal entscheidet über Nachbesetzen, Leerplatz oder Zurückstellung. | MUSS | V1 |
| F-BRD-085 | Gruppenschutz: Gruppen werden nach dem Aufruf niemals automatisch getrennt. Fehlen Mitglieder, entscheidet das Flight-Line-Personal zwischen unvollständig fliegen, Gruppe gemeinsam zurückstellen oder Platz leer lassen. | MUSS | V1 |
| F-BRD-090 | Ein Umlauf kann vor IM FLUG abgebrochen werden; alle Tickets kehren unter Erhalt ihrer Gruppenbindung an die vorderste passende Warteschlangenposition zurück. | MUSS | V1 |
| F-BRD-100 | Das System misst getrennt mindestens Boardingdauer, Flugzeit, Zeit von Landung bis Abschluss und gesamte Umlaufzeit. Die Messpunkte werden aus den Primärereignissen abgeleitet. | MUSS | V1 |
| F-BRD-110 | Anwesenheitsabgleich per QR-Scan oder Antippen in der Fluggruppenkarte. | SOLL | V1 |
| F-BRD-120 | Die geschätzte Passagierzuladung wird auf Basis konfigurierbarer Referenzgewichte neutral angezeigt. Sie trägt dauerhaft den Hinweis, dass die Entscheidung ausschließlich beim Piloten liegt und besitzt keine Freigabesemantik. | MUSS | V1 |
| F-BRD-130 | Sitzplatzzuordnung je Passagier innerhalb des Umlaufs. | SOLL | V2 |
| F-BRD-140 | Vollständige Schwerpunktberechnung als getrenntes Pilotenwerkzeug mit echten Gewichten, Hebelarmen und Sitzpositionen; ohne Freigabewirkung für den organisatorischen Leitstand. | KANN | V3 |
| F-BRD-150 | Mehrere Flight Lines beziehungsweise Gates werden im Datenmodell ab V1 berücksichtigt; parallele Bedienung mehrerer Gates wird in V2 bereitgestellt. | SOLL | V2 |
| F-BRD-160 | GELANDET beendet nicht automatisch die Flugzeugbelegung. Erst ABGESCHLOSSEN/VERFÜGBAR kennzeichnet Ausstieg und Bodenprozess als beendet und gibt das Flugzeug für den nächsten Umlauf frei. | MUSS | V1 |

## 8.5 Flotte, Piloten, Pausen und Tanken

| ID | Anforderung | Priorität | Stufe |
| --- | --- | --- | --- |
| F-FLT-010 | Verwaltung der Flugzeugstammdaten einschließlich Ressourcengruppen-Zuordnung und Pflege im laufenden Betrieb. | MUSS | V1 |
| F-FLT-020 | Event-Status je Flugzeug: aktiv oder inaktiv für die Veranstaltung. | MUSS | V1 |
| F-FLT-030 | Live-Status je Flugzeug mindestens: verfügbar, Boarding, im Flug, gelandet/deboarding, Tanken vorgemerkt, Tanken aktuell, Pause, Flugbetrieb unterbrochen und kurzfristig inaktiv. Statuswechsel sind in höchstens zwei Interaktionen möglich. | MUSS | V1 |
| F-FLT-040 | Piloten werden ausschließlich über anonyme operative Codes geführt, die bei P-01 beginnen und live angelegt oder deaktiviert werden können. Namen, Lizenz-, Dokumenten- und Flugbuchdaten sind ausgeschlossen. | MUSS | V1 |
| F-FLT-050 | Tanken vorgemerkt reserviert eine passende operative Lücke ohne feste Zusage; Tanken aktuell nimmt das Flugzeug aus der Disposition. Beide Zustände wirken sofort auf Prognose und Kapazität. | MUSS | V1 |
| F-FLT-060 | Je Flugzeug führt das System einen Umlaufzähler seit dem letzten Tanken mit konfigurierbarer Erinnerungsschwelle. | SOLL | V1 |
| F-FLT-070 | Geschätzte Kraftstoffbilanz je Flugzeug als organisatorische Erinnerungshilfe mit Startfüllstand, pauschalem Verbrauch, Warnschwelle und Korrektur beim Tanken; ohne Sicherheitsfunktion. | SOLL | V2 |
| F-FLT-080 | Die aktuelle Ressourcengruppe und ihre Queue sind am Flugzeug sichtbar. Status- oder Gruppierungsänderungen lösen eine automatische Neuplanung aller abhängigen Prognosen aus. | MUSS | V1 |
| F-FLT-090 | Pausen können je Flugzeug oder anonymem Pilotencode ohne Dauer oder mit geschätzter Dauer erfasst werden. Ein bekanntes Pausenende darf als unsichere erwartete Verfügbarkeit in Prognosen einfließen; tatsächlich verfügbar wird die Ressource erst nach menschlicher Bestätigung. Eine Pause ohne Dauer nimmt die Ressource vollständig aus der prognostizierten Kapazität. | SOLL | V1 |

## 8.6 Prognose, Disposition und Kapazität

| ID | Anforderung | Priorität | Stufe |
| --- | --- | --- | --- |
| F-PRG-010 | Für alle relevanten Prozesspunkte unterscheidet das System Planzeit, Prognosezeit und Ist-Zeit. Diese Werte werden getrennt gespeichert und angezeigt. | MUSS | V1 |
| F-PRG-020 | Nach jedem relevanten Ereignis werden erwartetes Boarding, Start, Landung, Abschluss, verbleibende Wartezeit und alle abhängigen Folgeflüge automatisch neu berechnet. | MUSS | V1 |
| F-PRG-030 | Die Prognose berücksichtigt mindestens Produktdauer, Flugzeugprofil, Boarding-, Flug-, Deboarding- und Pufferzeiten, aktuelle Flugzeugzustände, Pausen, Tanken, Unterbrechungen und Queue-Reihenfolge. | MUSS | V1 |
| F-PRG-040 | Tatsächlich gemessene Ereignisdauern müssen stärker in die Prognose eingehen als statische Planwerte. Planwerte dienen als Start- und Rückfallwerte. | MUSS | V1 |
| F-PRG-050 | Bei wenigen oder fehlenden Tagesmesswerten verwendet das System einen nachvollziehbaren Kaltstart aus Stammdaten und historischen Parametern, ohne die Prognose als hochsicher darzustellen. | MUSS | V1 |
| F-PRG-060 | Ausreißer, abgebrochene Flüge, aktive Unterbrechungen und fehlerhaft korrigierte Ereignisse dürfen Durchschnittswerte nicht unkontrolliert verzerren. Die Behandlung muss im Pflichtenheft nachvollziehbar beschrieben werden. | SOLL | V1 |
| F-PRG-070 | Interne Rollen sehen konkrete Prognosezeitpunkte für Boarding, Start, Landung und Abschluss sowie die zugrunde liegende Unsicherheit. | MUSS | V1 |
| F-PRG-080 | Gegenüber Gästen werden Countdown oder Zeitfenster kommuniziert. Eine einzelne exakte Uhrzeit darf nicht als feste Zusage erscheinen; ein ungefähres Uhrzeitfenster ist zulässig. | MUSS | V1 |
| F-PRG-090 | Jede Prognose besitzt eine Qualitäts- oder Unsicherheitsangabe, z. B. hoch/mittel/gering oder ein Zeitintervall. Weit entfernte Fluggruppen erhalten breitere Intervalle. | SOLL | V1 |
| F-PRG-100 | Das System erkennt Verspätungen und ungeplante Verlängerungen anhand ausbleibender Ereignisse und gemessener Abweichungen und aktualisiert den Folgeplan ohne manuelle Zeitkorrektur. | MUSS | V1 |
| F-PRG-110 | Bei mehreren Flugzeugen einer Ressourcengruppe darf das System noch nicht festgelegte Fluggruppen auf ein früher verfügbares kompatibles Flugzeug umplanen. Ab NEXT sind Änderungen bestätigungspflichtig. | MUSS | V1 |
| F-PRG-120 | Prognose-Snapshots werden zu definierten Zeitpunkten gespeichert, damit Prognosegüte und Entwicklung nach dem Event ausgewertet werden können. | SOLL | V1 |
| F-PRG-130 | Operative Eingriffe erfolgen grundsätzlich über reale Zustände und Ereignisse wie Pause, Tanken, Blockierung oder Wetterunterbrechung. Das direkte Überschreiben einzelner Folgezeiten ist im Regelbetrieb nicht vorgesehen. | MUSS | V1 |
| F-KAP-010 | Das System berechnet laufend die realistisch verbleibende Kapazität je Produkt und Ressourcengruppe aus aktiven Flugzeugen, Prognosedauern, verbleibender Betriebszeit, offenen Tickets und Blockierungen. | MUSS | V1 |
| F-KAP-020 | Kapazitätsampel je Produkt und Ressourcengruppe mit konfigurierbaren Schwellwerten; sichtbar an Kasse und Administration. Farben werden stets durch Text oder Symbol ergänzt. | MUSS | V1 |
| F-KAP-030 | Harter Verkaufsschluss zu einer konfigurierbaren Uhrzeit mit rechtzeitiger Vorwarnung. Er wirkt zusätzlich zur dynamischen Kapazitätsentscheidung. | MUSS | V1 |
| F-KAP-040 | Produkte und Ressourcengruppen können live auf verkaufbar beziehungsweise nicht verkaufbar gesetzt werden; jede Änderung wird protokolliert. | MUSS | V1 |
| F-KAP-050 | Die Kasse erhält eine konkrete, vorsichtige Verkaufsempfehlung je Produkt, einschließlich Restplätzen und Prognosefenster. | SOLL | V1 |
| F-KAP-060 | Bei geringer Prognosequalität muss die Verkaufsempfehlung konservativer ausfallen oder eine manuelle Freigabe verlangen. | SOLL | V1 |

## 8.7 Wetter, Betriebsunterbrechung und Notfallmodus

| ID | Anforderung | Priorität | Stufe |
| --- | --- | --- | --- |
| F-WET-010 | Globale oder ressourcengruppenspezifische Wetter- und Betriebshinweise können gesetzt werden und erscheinen auf Bediengeräten, Monitoren und Status-Seiten. Ein Hinweis löst nicht automatisch einen sicherheitsrelevanten Flugstopp aus. | MUSS | V1 |
| F-WET-020 | Flugbetrieb unterbrochen ist je Flugzeug, Ressourcengruppe oder gesamter Veranstaltung setzbar. Nicht betroffene Ressourcen laufen unverändert weiter. | MUSS | V1 |
| F-WET-030 | Hinweise, Unterbrechungen und deren Aufhebung werden mit Zeitstempel und auslösendem Gerät protokolliert. | MUSS | V1 |
| F-WET-040 | Für organisatorische Zwecke darf eine unverbindliche erwartete Mindestdauer oder ein Prüfzeitpunkt der Unterbrechung erfasst werden. Dies ist keine direkte manuelle Korrektur einzelner Flugzeiten. | SOLL | V1 |
| F-NOT-010 | Administrator, Leiter Flight Line und Flugleitung können den Notfallmodus in maximal zwei Interaktionen auslösen. | MUSS | V1 |
| F-NOT-020 | Der Notfallmodus sperrt sofort Verkauf und neue Aufrufe, schaltet öffentliche Anzeigen auf neutralen Inhalt und kennzeichnet alle Bediengeräte deutlich. | MUSS | V1 |
| F-NOT-030 | Laufende Flüge bleiben unverändert und können weiter mit GELANDET und ABGESCHLOSSEN dokumentiert werden. | MUSS | V1 |
| F-NOT-040 | Das Aufheben des Notfallmodus erfordert die Administrator-PIN. Auslösung und Aufhebung werden protokolliert. | MUSS | V1 |

## 8.8 Besucher-, FIDS- und Boardinganzeigen

| ID | Anforderung | Priorität | Stufe |
| --- | --- | --- | --- |
| F-MON-010 | Der Fluggastmonitor zeigt mindestens Produkt, Fluggruppen-/Slotnummer, Gate, Status, aktuelle Boardingaufrufe und die nächsten Fluggruppen mit Countdown oder Zeitfenster. Er besitzt ein modernes Standardprofil und ein klassisches Terminalprofil. Abgeflogene Zeilen zeigen kurz DEPARTED beziehungsweise Abgeflogen und verschwinden nach einer konfigurierbaren Nachlaufzeit, ohne fachliche Daten zu löschen. | MUSS | V1 |
| F-MON-020 | Der Boardingmonitor zeigt mehrere kommende Fluggruppen, Ticketnummern, Gate und nach Zuordnung das Flugzeug sowie eine Flottenstatuszeile. | MUSS | V1 |
| F-MON-030 | Monitore laufen im Vollbild-Kioskmodus, aktualisieren sich in Echtzeit, verbinden sich automatisch neu und benötigen während des Veranstaltungstags keinen manuellen Eingriff. | MUSS | V1 |
| F-MON-040 | Personenbezogene Daten auf Monitoren sind ausgeschlossen. Angezeigt werden nur Ticket-/Fluggruppenkennungen, Produkte, Gates, Status und Betriebsinformationen. | MUSS | V1 |
| F-MON-050 | Im Notfallmodus zeigen alle öffentlichen Monitore unverzüglich einen neutralen Hinweis ohne Aufrufe. | MUSS | V1 |
| F-MON-060 | Das Standardprofil verwendet die deutsche öffentliche Terminologie. Das Terminalprofil verwendet ausschließlich englische beschreibende Begriffe, insbesondere DEPARTURES, WAITING, GO TO GATE, BOARDING, DELAYED und DEPARTED; der Produkt-Eigenname darf unverändert bleiben. | MUSS | V1 |
| F-MON-070 | Statusfarben sind systemweit einheitlich, werden aber stets zusätzlich durch Text oder Symbol erläutert. | MUSS | V1 |
| F-MON-080 | Die Anzeige kann je Gate, Flight Line oder Ressourcengruppe gefiltert werden; der parallele Mehr-Gate-Betrieb der Bedienoberfläche folgt in V2. | SOLL | V2 |

## 8.9 Gastinformation und Benachrichtigung

| ID | Anforderung | Priorität | Stufe |
| --- | --- | --- | --- |
| F-BEN-010 | Jedes Ticket verlinkt per QR-Code auf eine öffentliche Status-Seite ohne Anmeldung. Sie zeigt Produkt, Fluggruppe, öffentlichen Status, verbleibende Wartezeit beziehungsweise Zeitfenster, Position, Gate, Hinweise und Zeitpunkt der letzten Aktualisierung. | MUSS | V1 |
| F-BEN-020 | Gäste können Web-Push-Benachrichtigungen je Ticket aktivieren, ohne App-Installation und ohne Telefonnummer. | MUSS | V1 |
| F-BEN-030 | Das System löst aus Prognose, Queue-Position, Prognosequalität und maximal akzeptierter Gate-Wartezeit automatisch den Voraufruf „Bitte zum Gate“ beziehungsweise GO TO GATE aus. Schwellen und Vorlauf sind konfigurierbar. NEXT bleibt davon getrennt, bindet erst nach menschlicher Bestätigung das Flugzeug und startet Boarding sowie den verbindlichen Aufruf. | MUSS | V1 |
| F-BEN-040 | Benachrichtigungen können alternativ an der Kasse für die Ticketnummer aktiviert werden. | MUSS | V1 |
| F-BEN-050 | SMS als zusätzlicher Kanal über einen externen Versanddienst mit Warteschlange, Wiederholung und sichtbarem Versandstatus. | SOLL | V2 |
| F-BEN-060 | Falls Telefon- oder Messenger-Kanäle in einer späteren Stufe ergänzt werden, erfordert jede Registrierung eine dokumentierte Einwilligung mit Zeitpunkt und Kanal. V1 erfasst keine Telefonnummern. | MUSS | V2 |
| F-BEN-070 | Bei relevanten Änderungen wie erheblicher Verschiebung, Unterbrechung, Gate-Wechsel oder Notfallmodus werden betroffene registrierte Gäste informiert. | SOLL | V2 |
| F-BEN-080 | WhatsApp oder vergleichbarer Messenger über eine offizielle Business-Schnittstelle mit dokumentierter Einwilligung. | KANN | V3 |
| F-BEN-090 | Öffentliche Statusbezeichnungen sind auf wenige handlungsorientierte Zustände zu reduzieren: Warten, Bitte zum Gate, Boarding, Abgeflogen beziehungsweise Flug läuft, Verzögert, Gelandet und Abgeschlossen. Das Terminalprofil bildet diese ausschließlich auf WAITING, GO TO GATE, BOARDING, DEPARTED und DELAYED ab. | MUSS | V1 |
| F-BEN-100 | Bei unsicherer oder unterbrochener Prognose zeigt die Status-Seite einen ehrlichen Hinweis statt eines scheinbar präzisen Countdowns. | MUSS | V1 |

## 8.10 Historie, Protokoll und Auswertung

| ID | Anforderung | Priorität | Stufe |
| --- | --- | --- | --- |
| F-HIS-010 | Flüge, Fluggruppen und Tickets werden dauerhaft gespeichert und sind nach Datum, Flugzeug, Pilot, Produkt, Ressourcengruppe, Slotnummer, Ticket und Status filterbar. | MUSS | V1 |
| F-HIS-020 | Unveränderliches, nur anfügendes Ereignisprotokoll mindestens für Verkauf, Storno, Umbuchung, Aufruf, Check-in, IM FLUG, GELANDET, ABGESCHLOSSEN, Zurückstellung, No-Show, Pilot- und Ressourcenwechsel, Tanken, Wetter, Unterbrechung, Notfallmodus und manuelle Disposition. | MUSS | V1 |
| F-HIS-030 | Automatischer Tagesbericht als PDF und CSV mit Flügen, Passagierzahlen, Auslastung, gemessenen Prozesszeiten, Wartezeiten, Ticket-Zählbericht je Produkt, Prognoseentwicklung und besonderen Ereignissen. | SOLL | V1 |
| F-HIS-040 | CSV-Export der fachlichen Rohdaten für Vereinsabrechnung und eigene Auswertungen. | MUSS | V1 |
| F-HIS-050 | Statistik-Dashboard über mehrere Veranstaltungen mit Durchsatz, Auslastung, Wartezeit und Prognosegüte. | SOLL | V2 |
| F-HIS-060 | Prognose-Snapshots und zugehörige Ist-Ergebnisse sind auswertbar, insbesondere Abweichung von Boarding-, Start- und Abschlussprognose. | SOLL | V1 |
| F-HIS-070 | Kennzahlen wie Boardingdauer, Flugzeit, Bodenzeit, Umlaufzeit und Wartezeit besitzen im System eindeutige, dokumentierte Start- und Endereignisse. | MUSS | V1 |

## 8.11 Administration und Geräteverwaltung

| ID | Anforderung | Priorität | Stufe |
| --- | --- | --- | --- |
| F-ADM-010 | Pflege der Veranstaltungsparameter einschließlich Verkaufszeiten, Betriebsende, Fristen, Ampelschwellen, Referenzgewichte, Benachrichtigungsvorlauf sowie Planwerte und Prognoseparameter. | MUSS | V1 |
| F-ADM-020 | Stammdaten für Produkte, Ressourcengruppen, Flugzeuge, anonyme Pilotencodes und Gates sind auch während des Betriebs änderbar; Zuordnungen werden direkt an der Ressourcengruppe gepflegt. Änderungen werden protokolliert und wirken kontrolliert auf den Livezustand. | MUSS | V1 |
| F-ADM-030 | Gerätekopplung ohne persönliche Helferkonten: Der Administrator koppelt ein Gerät per QR-Code mit einer festen Rolle für die Veranstaltung. Kopplungen sind einzeln widerrufbar. | MUSS | V1 |
| F-ADM-040 | Geräteübersicht mit Rolle, Online-Status, letztem Kontakt und, soweit verfügbar, Akkustand. | SOLL | V1 |
| F-ADM-050 | Kritische Aktionen wie Storno, Aufheben des Notfallmodus, Löschen von Stammdaten und wesentliche Live-Konfigurationsänderungen erfordern eine Administrator-PIN. | MUSS | V1 |
| F-ADM-060 | Kompakte Administrationsübersicht mit offenen Tickets, Durchsatz, mittleren Prozesszeiten, Prognosequalität sowie Geräte- und Benachrichtigungsstatus. Operative Flottensteuerung liegt in der Flight-Line-Supervisor-Ansicht. | SOLL | V1 |
| F-ADM-070 | Trainingsmodus mit Beispieldaten und vollständiger Rücksetzung; Trainingsdaten dürfen nicht in Auswertungen einfließen. | KANN | V2 |
| F-ADM-080 | Verwaltung mehrerer Veranstaltungen mit eventübergreifender Stammdatenbibliothek und Kopie einer Vorveranstaltung als Vorlage. | MUSS | V1 |
| F-ADM-090 | Dashboard Flugleitung als primär lesende Gesamtsicht mit offenen Tickets, Ressourcenstatus, laufenden Flügen, Kapazität, Prognosen und Not-Halt. | SOLL | V1 |
| F-ADM-100 | Die Administration verhindert technisch ungültige Ressourcengruppen-Zuordnungen und zeigt Konflikte vor dem Speichern verständlich an. | MUSS | V1 |

## 8.12 Schnittstellen und spätere Erweiterungen

| ID | Anforderung | Priorität | Stufe |
| --- | --- | --- | --- |
| F-INT-010 | Die Architektur stellt eine dokumentierte interne Schnittstelle für Ereignisse und Statusabfragen bereit, damit spätere Datenquellen ohne Neuentwicklung des Kerns angebunden werden können. | MUSS | V1 |
| F-INT-020 | ADS-B- oder Flugbewegungsmonitoring zur Plausibilisierung von Start, Landung und ETA. | KANN | V3 |
| F-INT-030 | Automatische Erkennung von Start und Landung als Vorschlag oder konfigurierbare automatische Ereignisquelle. | KANN | V3 |
| F-INT-040 | Digitale Passagierlisten werden, falls erforderlich, als separates Modul mit eigener Berechtigung, Rechtsgrundlage und Löschfrist umgesetzt; keine stillschweigende Erweiterung des datensparsamen Kern-Ticketings. | KANN | V3 |
| F-INT-050 | Online-Vorverkauf mit Kontingentsteuerung bleibt optional und darf den Vor-Ort-Regelbetrieb nicht voraussetzen. | KANN | V3 |
| F-INT-060 | Mehrere Flugplätze und Mandantenfähigkeit für mehrere Veranstalter. | KANN | V4 |
| F-INT-070 | Mehrere Kassen- und Flight-Line-Geräte dürfen bereits in V1 parallel auf denselben Livezustand zugreifen. Flight Line Assist koordiniert die kurzzeitige Betreuung eines Flugzeugs über anonyme, auslaufende Gerätereservierungen; fachliche Schreibkommandos bleiben versioniert und konfliktgeprüft. Mehrere organisatorisch unabhängige Flight Lines folgen in V2. | MUSS | V1 |

# 9 Datenanforderungen

Die folgenden Angaben definieren die fachlich zu führenden Daten. Die technische Modellierung und Normalisierung obliegen dem Auftragnehmer, müssen jedoch die beschriebenen Invarianten und Historisierungsanforderungen erfüllen.
| ID | Anforderung | Priorität | Stufe |
| --- | --- | --- | --- |
| D-010 | Flugzeug: Kennzeichen, Typ, Passagierkapazität, maximale Passagierzuladung, Gate, Event- und Live-Status, aktueller Pilotencode, Zeitprofile, Tankhinweise, optionale geschätzte Pausendauer und aktive Ressourcengruppe. | MUSS | V1 |
| D-015 | Ressourcengruppe: Bezeichnung, Status, zugehörige Produkte, Prognoseparameter, Gates, aktive Flugzeugzuordnungen und daraus abgeleitete Kapazitätsspanne. | MUSS | V1 |
| D-016 | Ressourcengruppen-Zuordnung: Flugzeug, Ressourcengruppe, gültig ab/bis, aktiv, Änderungsgrund und Protokollbezug. | MUSS | V1 |
| D-020 | Produkt: Bezeichnung, Kürzel, Preis, genau eine Ressourcengruppe, öffentliche Darstellung, Referenzdauer, Verkaufsregeln, Begleitpflicht und Sortierung; keine manuell gepflegte Referenzkapazität. | MUSS | V1 |
| D-030 | Ticket: nicht erratbare Ticketnummer, Produkt, Fluggruppe beziehungsweise Queue-Position, Gruppen-ID, optionale Gewichtsklasse, Standby, Status und Verkaufszeitpunkt. Namen, Telefonnummern und Zahlungsdaten werden nicht im Ticketkern gespeichert; Web-Push-Registrierungen sind getrennt. | MUSS | V1 |
| D-040 | Buchungsgruppe: Gruppen-ID, Größe, zugehörige Tickets, Gruppenbindung, Standby-Regel und gegebenenfalls Aufteilung auf unmittelbar aufeinanderfolgende Fluggruppen. | MUSS | V1 |
| D-045 | Fluggruppe/Slot: stabile Tageskennung, Produkt, Ressourcengruppe, Tickets, Queue-Position, öffentliche Statusinformation, prognostizierte Zeitfenster und gegebenenfalls zugeordneter Umlauf. | MUSS | V1 |
| D-050 | Flug/Umlauf: Fluggruppe, Flugzeug, anonymer Pilotencode, Gate, Tickets, Status, Plan-, Prognose- und Ist-Zeiten für Aufruf, Boarding, Start, Landung und Abschluss sowie anonyme organisatorische Bemerkungen. | MUSS | V1 |
| D-055 | Prognose-Snapshot: Erstellzeitpunkt, Bezug, prognostizierte Prozesszeiten, Zeitfenster, Qualitätsstufe, verwendete Datengrundlage und Auslöser der Neuberechnung. | SOLL | V1 |
| D-060 | Pilot: anonymer operativer Code, aktiv, aktuelle Zuordnung und optionale nicht personenbezogene Bemerkung; keine Namen, Lizenz- oder Dokumentendaten. | MUSS | V1 |
| D-065 | Blockierung/Unterbrechung/Pause: Geltungsbereich, Typ, Beginn, optionaler erwarteter Rückkehr- oder Prüfzeitpunkt, Status, Grund und bestätigte Aufhebung. | MUSS | V1 |
| D-070 | Gate/Flight Line: Bezeichnung, Art, zugeordnete Ressourcengruppen und Anzeigefilter. | MUSS | V1 |
| D-080 | Gerät: Bezeichnung, Rolle, Kopplung, letzter Kontakt, aktiv und technische Statusinformationen. | MUSS | V1 |
| D-090 | Ereignis: fortlaufende ID, Zeitstempel, Ereignistyp, Quelle, auslösendes Gerät, fachlicher Bezug, Nutzdaten und gegebenenfalls Korrekturbezug. | MUSS | V1 |
| D-100 | Veranstaltung: Name, Datum, Flugplatz, Zeitzone, Parameter, Notfallstatus, Betriebsphasen und Archivkennzeichen. | MUSS | V1 |
| D-110 | Benachrichtigungsregistrierung: Ticketbezug, Kanal, Zielkennung soweit erforderlich, Einwilligung, Status und Löschzeitpunkt. | MUSS | V1 |

# 10 Nichtfunktionale Anforderungen

## 10.1 Bedienbarkeit und Oberfläche

| ID | Anforderung | Priorität | Stufe |
| --- | --- | --- | --- |
| Q-UX-010 | Alle Bedienoberflächen sind für Fingerbedienung auf Tablets ausgelegt: große Bedienelemente, hoher Kontrast für Sonnenlicht und maximal eine hervorgehobene Primäraktion je Arbeitszustand. | MUSS | V1 |
| Q-UX-020 | Kasse und Flight Line kommen im Standardablauf ohne Menünavigation aus. Flight Line besitzt eine Desktop-Supervisor-Ansicht und eine vereinfachte Assistenzansicht für iPad, iPad mini, iPhone und vergleichbare Geräte. Die Administration zeigt kompakte Tabellen; Formulare öffnen nur nach Neu oder Bearbeiten. | MUSS | V1 |
| Q-UX-030 | Häufige Aktionen sind ohne Bestätigungsdialog ausführbar und mindestens zehn Sekunden rückgängig zu machen. Weitreichende destruktive Aktionen erfordern PIN oder explizite Bestätigung. | MUSS | V1 |
| Q-UX-040 | Statusbegriffe, Farben und Symbole sind systemweit einheitlich. | MUSS | V1 |
| Q-UX-050 | Doppelte Eingaben dürfen keine doppelten Buchungen, Ereignisse oder Statuswechsel erzeugen. | MUSS | V1 |
| Q-UX-060 | Die deutsche Bedienoberfläche muss nach höchstens zehn Minuten Einweisung je Helferrolle sicher bedienbar sein. | MUSS | V1 |
| Q-UX-070 | Umschaltbares helles und dunkles Farbschema für Sonne, Dämmerung und Abendbetrieb auf allen Bedienoberflächen. | MUSS | V1 |
| Q-UX-080 | Öffentliche Ansichten formulieren handlungsorientiert und vermeiden interne Fachbegriffe, wenn diese für Gäste nicht erforderlich sind. | MUSS | V1 |

## 10.2 Zuverlässigkeit und Verbindungsverhalten

| ID | Anforderung | Priorität | Stufe |
| --- | --- | --- | --- |
| Q-ZUV-010 | Status- und Prognoseänderungen sind im Normalbetrieb innerhalb von zwei Sekunden auf allen verbundenen Geräten sichtbar. | MUSS | V1 |
| Q-ZUV-020 | Verbindungsaussetzer und vorübergehende Server- oder D1-Fehler werden ohne Leeren der Oberfläche überbrückt. Der letzte bestätigte Stand bleibt mit Alter und Verbindungsstatus sichtbar; unbestätigte Schreibaktionen bleiben gesperrt und werden nicht als operative Änderungen gezählt. | MUSS | V1 |
| Q-ZUV-030 | Nach einer Störung stellen Geräte die Verbindung automatisch wieder her und gleichen den Zustand vollständig ab; ein manueller Neustart ist nicht erforderlich. | MUSS | V1 |
| Q-ZUV-040 | Widersprüchliche parallele Bedienung wird serverseitig konfliktgeprüft aufgelöst. Kein Gerät darf einen neueren Zustand mit einem veralteten Stand überschreiben. | MUSS | V1 |
| Q-ZUV-050 | Das System ist für mindestens zwölf Stunden durchgehenden Veranstaltungseinsatz ohne Neustart ausgelegt. | MUSS | V1 |
| Q-ZUV-060 | Verfügbarkeit der zentralen Serverumgebung während des Veranstaltungszeitraums mindestens 99,5 Prozent; geplante Wartung an Veranstaltungstagen ist ausgeschlossen. | MUSS | V1 |
| Q-ZUV-070 | Für Totalausfall der Verbindung besteht eine dokumentierte Papier-Rückfallebene einschließlich geregelter Wiedereinpflege nach Wiederanlauf. | MUSS | V1 |

## 10.3 Performance und Mengengerüst

| ID | Anforderung | Priorität | Stufe |
| --- | --- | --- | --- |
| Q-PER-010 | Lokale Reaktion der Bedienoberfläche auf Eingaben unter 300 ms; serverseitiger Abschluss eines Standardverkaufs im Normalbetrieb unter zwei Sekunden. | MUSS | V1 |
| Q-PER-020 | Auslegung mindestens auf 20 gleichzeitig verbundene Geräte, 1.000 Tickets, 300 Flugumläufe je Veranstaltungstag und fünf Jahre Historie ohne spürbare Verschlechterung. | MUSS | V1 |
| Q-PER-030 | Eine vollständige Neuberechnung der V1-Prognose für alle offenen Fluggruppen erfolgt im festgelegten Mengengerüst in höchstens zwei Sekunden. | MUSS | V1 |

## 10.4 Sicherheit, Datenschutz und Zugriffsschutz

| ID | Anforderung | Priorität | Stufe |
| --- | --- | --- | --- |
| Q-SIC-010 | Sämtliche Kommunikation erfolgt verschlüsselt über HTTPS/TLS. | MUSS | V1 |
| Q-SIC-020 | Schreibzugriff ist nur für gekoppelte Geräte mit rollenbezogener Berechtigung zulässig; jede Schreiboperation ist einem Gerät zuordenbar. | MUSS | V1 |
| Q-SIC-030 | Die öffentliche Status-Seite gibt ausschließlich Informationen zum jeweiligen nicht erratbaren Ticketcode preis. Aufzählbarkeit und automatisierte Fehlversuche werden begrenzt. | MUSS | V1 |
| Q-SIC-040 | Es werden keine Werbung, kein Tracking und keine externen Analysedienste eingebunden. | MUSS | V1 |
| Q-DSG-010 | Im Kernsystem werden keine Gastnamen oder sonstigen nicht erforderlichen Personendaten erfasst. Der Betrieb funktioniert vollständig ohne Telefonnummer. | MUSS | V1 |
| Q-DSG-020 | Push-Registrierungen werden nach einer konfigurierbaren Frist nach Veranstaltungsende, standardmäßig sieben Tage, gelöscht oder irreversibel entkoppelt. V1 speichert keine Telefonnummern. | MUSS | V1 |
| Q-DSG-030 | Einwilligungen werden mit Zeitpunkt und Kanal dokumentiert; Datenschutzhinweise sind auf der Status-Seite abrufbar. | MUSS | V1 |
| Q-DSG-040 | Personenbezogene Daten werden ausschließlich in Rechenzentren innerhalb der EU verarbeitet; erforderliche Auftragsverarbeitungsverträge und Angaben für das Verarbeitungsverzeichnis werden bereitgestellt. | MUSS | V1 |
| Q-DSG-050 | Ein späteres Passagierlistenmodul ist technisch und berechtigungsseitig vom datensparsamen Ticketing zu trennen. | MUSS | V3 |

## 10.5 Wartbarkeit, Erweiterbarkeit und Betriebskosten

| ID | Anforderung | Priorität | Stufe |
| --- | --- | --- | --- |
| Q-WAR-010 | Verwendung verbreiteter, quelloffener Standardtechnologien ohne exotische Abhängigkeiten; ein erfahrener Webentwickler kann sich ohne Herstellerbindung einarbeiten. | MUSS | V1 |
| Q-WAR-020 | Betriebliche Parameter, Texte, Schwellenwerte, Referenzzeiten und Gewichtsklassen sind ohne Programmänderung konfigurierbar. | MUSS | V1 |
| Q-WAR-030 | Laufende Grundbetriebskosten für Hosting, Domain und Zertifikate sollen ohne Mobilfunk- und volumenabhängige Versandkosten höchstens 15 Euro je Monat betragen. Abweichungen sind transparent zu begründen. | SOLL | V1 |
| Q-WAR-040 | Die Architektur ermöglicht V2 bis V4 ohne Neuentwicklung des Kerns; insbesondere sind Ressourcengruppen, mehrere Produkte je Gruppe, Gates, Mehrveranstaltungsbetrieb, Sitzplätze und externe Ereignisquellen von Beginn an modelliert. | MUSS | V1 |
| Q-WAR-050 | Prognoseverfahren, Zustandsautomaten und fachliche Invarianten sind in einer für Betreiber und zukünftige Entwickler nachvollziehbaren technischen Dokumentation beschrieben. | MUSS | V1 |

# 11 Technische Rahmenbedingungen

| ID | Anforderung | Priorität | Stufe |
| --- | --- | --- | --- |
| T-010 | Die Lösung ist eine responsive Progressive Web App; eine Installation aus einem App-Store ist nicht erforderlich. | MUSS | V1 |
| T-020 | Unterstützt werden aktuelle Versionen von Chrome, Safari und Edge auf Android-Tablets, iPads und Windows-PCs. | MUSS | V1 |
| T-030 | Zentraler Betrieb in einem EU-Rechenzentrum. Am Veranstaltungsort erfolgt die Anbindung über LTE/5G; ein Dual-SIM-Router unterschiedlicher Netzbetreiber wird empfohlen. | MUSS | V1 |
| T-035 | Bediengeräte besitzen lokale Zwischenspeicherung und Offline-Queue für kurze Ausfälle. Ein optionaler lokaler Edge-Betrieb darf später ergänzt werden, ohne das fachliche Modell zu ändern. | MUSS | V1 |
| T-040 | Monitore werden über handelsübliche Kiosk-Abspielgeräte betrieben und laden ihre Ansicht nach dem Einschalten automatisch im Vollbild. | MUSS | V1 |
| T-050 | Automatische tägliche Datensicherung mit mindestens 14 Tagen Aufbewahrung sowie Sicherung vor Veranstaltungstagen; dokumentierter Wiederanlauf innerhalb von 30 Minuten. | MUSS | V1 |
| T-060 | Zeitzonen- und sommerzeitfeste Verarbeitung, standardmäßig Europe/Berlin. | MUSS | V1 |
| T-070 | Getrennte Test-/Abnahmeumgebung und Produktivumgebung. | MUSS | V1 |
| T-080 | Vollständiger Quellcode, Konfiguration und Deploymentbeschreibung gehen in das uneingeschränkte Nutzungsrecht des Auftraggebers über; ein Betreiberwechsel darf nicht durch proprietäre Bindungen verhindert werden. | MUSS | V1 |
| T-090 | Echtzeitaktualisierung erfolgt über eine geeignete Push-Technik mit automatischem Fallback und Wiederverbindung. | MUSS | V1 |
| T-100 | Die technische Umsetzung muss die fachlichen Ereignisse, Zustandsübergänge und Invarianten transaktional konsistent verarbeiten. | MUSS | V1 |

# 12 Ausbaustufen (Roadmap)

| Stufe | Inhalt |
| --- | --- |
| V1 Produktiver Kernbetrieb | Produkte und Ressourcengruppen, mehrere Flugzeuge je Gruppe, ereignisbasierter Vier-Aktionen-Ablauf, dynamische Plan-/Prognose-/Ist-Zeiten, automatische Folgedisposition, Ticketverkauf, QR-Status, FIDS, Web-Push, Not-Halt, Protokoll, Bericht, Gerätekopplung und Offline-Überbrückung. |
| V2 Komfort und Betriebsausbau | SMS, Bondrucker, Warteliste, Gutscheine, paralleler Mehr-Gate-Betrieb, Sitzplatzzuordnung, erweiterte gemischte Kapazitätsoptimierung, Kraftstoffhinweise, Trainingsmodus, Statistik und Änderungsbenachrichtigungen. |
| V3 Integration und Vertiefung | ADS-B/Plausibilisierung, automatische Start-/Landeerkennung, getrenntes Passagierlistenmodul, Schwerpunktrechner, Mehrsprachigkeit, WhatsApp und optionaler Online-Vorverkauf. |
| V4 Plattformausbau | Mehrere Flugplätze und Veranstalter, veranstaltungsübergreifende Prognosemodelle, Helferplanung, Zusatzprodukte und weitergehende Schnittstellen. |

Vertragsgegenstand dieser Fassung ist grundsätzlich V1. Optionen V2 bis V4 sind getrennt auszuweisen. Die Architektur muss ihre Umsetzung ohne Neuentwicklung des fachlichen Kerns ermöglichen.
# 13 Lieferumfang und Abnahme

## 13.1 Lieferumfang

- Lauffähiges Gesamtsystem in Produktiv- und getrennter Test-/Abnahmeumgebung.
- Vollständiger Quellcode, Konfigurationen, Deployment- und Betriebsbeschreibung.
- Administrationshandbuch und laminierfähige Ein-Seiten-Kurzanleitungen für Kasse, Flight Line und Administration.
- Dokumentierte Papier-Rückfallprozedur einschließlich Wiedereinpflege nach Wiederanlauf.
- Checkliste für den Aufbau am Veranstaltungstag.
- Nachweis von Datensicherung und Wiederherstellung.
- Begleitung einer Generalprobe mit Originalhardware am Veranstaltungsort.
- Dokumentation von Zustandsautomaten, fachlichen Invarianten und Prognoseverfahren.
## 13.2 Abnahmeszenario V1

Die Abnahme umfasst einen simulierten Veranstaltungstag mit mindestens drei Flugzeugen, zwei Ressourcengruppen, drei Produkten, davon mindestens zwei Produkte in derselben Ressourcengruppe, 60 verkauften Tickets und 20 Umläufen.
- Standardverkauf, Gruppenkauf, Storno und Umbuchung.
- No-Show mit bestätigter Nachbesetzung und unvollständige Gruppe mit Gruppenschutzentscheidung.
- Slot-Teilung, Pilotwechsel, Tanken, Pilotenpause und Maschinenausfall.
- Längeres Boarding, längere Flugzeit und längeres Deboarding mit automatischer Neuberechnung aller Folgeprognosen.
- Umverteilung einer noch nicht aufgerufenen Fluggruppe auf ein früher verfügbares Flugzeug.
- Unterbrechung einer Ressourcengruppe und Fortbetrieb einer anderen.
- Notfallmodus mit laufendem Flug sowie Aufhebung per PIN.
- Simulierter Verbindungsabbruch von 60 Sekunden während des Betriebs.
- Wiederherstellungstest aus der Datensicherung.
## 13.3 Messbare Abnahmekriterien

| Kriterium | Sollwert / Nachweis |
| --- | --- |
| Standardverkauf | Regelfall unter 15 Sekunden und maximal sechs Interaktionen. |
| Standardumlauf | Vier Primäraktionen bei unverändertem Flugzeug und Piloten. |
| Live-Synchronisation | Status- und Prognoseänderungen innerhalb von zwei Sekunden auf allen Geräten sichtbar. |
| Prognosekaskade | Nach jedem simulierten Verzögerungsereignis werden alle betroffenen Folgeflüge ohne manuelle Einzelkorrektur neu berechnet. |
| Ressourceninvarianten | Keine Doppelzuordnung eines Flugzeugs zu aktiven Ressourcengruppen, keine Doppelbelegung von Tickets oder Piloten. |
| Zeitmodell | Plan-, Prognose- und Ist-Zeiten sind getrennt gespeichert; öffentliche Ansicht zeigt Zeitfenster oder Countdown. |
| Verbindungsstörung | Automatische Wiederverbindung ohne Datenverlust oder doppelte Ereignisse. |
| Monitore | Betrieb über den gesamten Testtag ohne manuellen Neustart. |
| Datenschutz | Keine Gastnamen im Kernsystem oder auf öffentlichen Anzeigen. |
| Generalprobe | Erfolgreicher Test mit echter Hardware am Veranstaltungsort; Bestandteil der Abnahme. |

# 14 Glossar

| Begriff | Erklärung |
| --- | --- |
| RMS | Rundflug-Management-System; gleichbedeutend mit Rundflug-Leitstand. |
| Produkt | Buchbares Angebot mit Preis und Leistungsprofil; verwendet genau eine Ressourcengruppe. |
| Ressourcengruppe | Operative Kapazität mit eigener Queue und einem oder mehreren Flugzeugen. |
| Flugzeugzuordnung | Zeitlich gültige Mitgliedschaft eines Flugzeugs in genau einer aktiven Ressourcengruppe. |
| Fluggruppe / Slot | Stabile Passagierkohorte mit öffentlicher Tagesnummer; keine feste Uhrzeit oder Maschine. |
| Umlauf / Rotation | Konkreter Rundflug mit Flugzeug, Pilot, Gate und Ereignissen. |
| Planzeit | Aus Stammdaten abgeleiteter Referenzwert. |
| Prognosezeit | Aktuell erwarteter Zeitpunkt aus Livezustand und Messdaten. |
| Ist-Zeit | Tatsächlich erfasster Zeitpunkt eines Ereignisses. |
| NEXT | Übernahme des aktuellen Vorschlags und Aufruf einer Fluggruppe; startet Boarding. |
| Standby | Freiwillige Bereitschaft, bei passender freier Kapazität früher aufgerufen zu werden. |
| No-Show | Aufgerufener Gast erscheint nicht innerhalb der Frist. Nachbesetzung erfolgt nur nach Personalentscheidung. |
| Flight Line / Boarding | Operativer Bereich für Aufruf, Anwesenheit, Einstieg, Start-, Lande- und Abschlussereignisse. |
| FIDS | Flughafenähnliche Informationsanzeige für öffentliche Flugstatus. |
| Notfallmodus | Systemweiter organisatorischer Stopp von Verkauf und neuen Aufrufen bei neutralen öffentlichen Anzeigen. |
| PWA | Progressive Web App ohne App-Store-Installation mit lokaler Zwischenspeicherung. |
| Web-Push | Browser-Benachrichtigung ohne App und ohne Telefonnummer. |

# Anhang A Konsolidierungs- und Entscheidungsmatrix

| Thema | Ansatz v1.3 | Ursprüngliches Fachkonzept | Konsolidierte Fassung 1.4 |
| --- | --- | --- | --- |
| Domänenmodell | Kategorie bündelt Produkt, Queue und Flotte. | Produkt, Ressourcengruppe und Flugzeug getrennt. | Trennung übernommen; Kategorie nur noch optionale Darstellung. |
| Queue | Je Kategorie. | Je Ressourcengruppe. | Queue je Ressourcengruppe; Produktkennungen bleiben sichtbar. |
| Slot | Feste sichtbare Slotgruppe, weich behandelbar. | Dynamischer Flug ohne starre Zeit. | Slot als stabile Kommunikationskohorte; Maschine und Zeit dynamisch. |
| Zeitangaben | Nur Zeitspannen, keine Uhrzeiten. | Plan-, Prognose- und Ist-Zeit mit erwarteten Boarding-/Startzeiten. | Intern konkrete Prognose; extern Fenster/Countdown. |
| Flight-Line-Ereignisse | NEXT, Bestätigen, IM FLUG, GELANDET. | Check-in, Boarding, Start, Landung, Check-out. | Vier Primäraktionen: NEXT, IM FLUG, GELANDET, ABGESCHLOSSEN; Check-in optional. |
| Mehrflugzeugbetrieb | Mehrere Maschinen in einer Kategorie, überwiegend sitzplatzhomogen. | Ressourcengruppe mit dynamischer Verteilung. | Mehrere Maschinen je Gruppe als V1-Kern; konkrete Kapazität entscheidet. |
| Gewichtsdaten | Gewichtsklassen verpflichtend in V1. | Gewicht/Schwerpunkt als spätere Erweiterung. | Gewichtsklassen konfigurierbar; neutrale Schätzung, Schwerpunkt getrennt später. |
| Ticket | Vorgedruckte QR-Tickets V1, Bondrucker V2. | Ticketdruck mit QR-Code. | V1 unterstützt vorgedruckt und druckbar/digital; Hardwareintegration V2. |
| Hosting | EU-Cloud über LTE/5G mit Kurzzeitpuffer. | Robuster Betrieb am Platz, lokale Option denkbar. | EU-Cloud-PWA V1; Offline-Queue und Papierfallback, Edge optional später. |
| Datenschutz | Keine Gastnamen oder Telefonnummern; freiwilliges ticketbezogenes Web-Push getrennt. | Spätere digitale Passagierlisten denkbar. | Datensparsamer Kern bleibt; Listen nur als getrenntes Modul. |

| Freigabehinweis Vor Beauftragung sollten Auftraggeber, Flight-Line-Verantwortliche, Kasse, Flugleitung und ein technischer Auftragnehmer die V1-MUSS-Anforderungen gemeinsam in einer moderierten Durchsicht bestätigen. Offene rechtliche oder vereinsinterne Betriebsregeln sind als gesonderte Entscheidungen zu dokumentieren. |
| --- |
