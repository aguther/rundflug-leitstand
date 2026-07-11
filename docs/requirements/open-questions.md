# Offene fachliche Entscheidungen

Diese Liste enthält ausschließlich Fragen, die mindestens ein V1-Arbeitspaket blockieren. Sie ändert
keine Anforderung und darf nicht durch eine technische Implementierungsannahme ersetzt werden. Eine
Entscheidung wird mit Datum, verantwortlicher Rolle, Begründung und betroffenen Anforderungs-IDs
dokumentiert. `ABGESCHLOSSEN/VERFÜGBAR` ist gemäß Lastenheft bereits das Ereignis, das nach
`GELANDET` den Turnaround beendet; dies ist daher keine offene Frage.

| Nr. | Blockierende Entscheidung | Betroffene Anforderungen | Entscheidung durch | Benötigt vor | Blockiert |
|---|---|---|---|---|---|
| OQ-01 | Welche Kommandotypen dürfen während eines kurzen Offline-Zustands lokal angenommen werden? Welche Aktionen, insbesondere `NEXT`, `IM FLUG`, `GELANDET`, `ABGESCHLOSSEN`, Verkauf, Storno, Umbuchung, Not-Halt und Stammdatenänderungen, benötigen zwingend eine Online-Bestätigung? | T-035, Q-ZUV-020, Q-ZUV-040, F-EVT-020, F-INT-070 | Auftraggeber, Leiter Flight Line und Datenschutz/IT-Betrieb | Spezifikation von BP-09 | BP-04, BP-08, BP-09 |
| OQ-02 | Welche der häufigen Aktionen müssen innerhalb der Zehn-Sekunden-Frist rückgängig sein, und welches fachliche Korrekturereignis gilt jeweils? Was passiert, wenn bereits ein abhängiges Folgeereignis vorliegt? | Q-UX-030, F-EVT-030, F-HIS-020 | Auftraggeber und Leiter Flight Line | Zustandsautomaten von BP-04/BP-05 | BP-04, BP-05, BP-10 |
| OQ-03 | Unter welchen Bedingungen darf eine Buchungsgruppe auf unmittelbar aufeinanderfolgende Fluggruppen verteilt werden, wer bestätigt die Teilung und wie bleibt die Gruppenbindung sichtbar? | D-040, F-SLT-020, F-SLT-050, F-SLT-090 | Auftraggeber, Kasse und Leiter Flight Line | Queue-Regeln von BP-05 | BP-05 |
| OQ-04 | Darf eine bereits aufgerufene Fluggruppe einem anderen kompatiblen Flugzeug zugeordnet werden? Falls ja: welche Rollen dürfen vorschlagen und bestätigen, und welche öffentlichen Informationen bleiben unverändert? | F-BRD-025, F-BRD-030, F-PRG-110, D-045, D-050 | Auftraggeber und Leiter Flight Line | Sonderfallmodell von BP-05 | BP-05, BP-06 |
| OQ-05 | Wie werden Prognosequalität und Zeitfenster intern, an der Kasse, auf Monitoren und auf der Ticketstatusseite abgestuft und formuliert? Welche Schwellen führen statt eines Countdowns zu einem Unsicherheitshinweis? | F-PRG-070, F-PRG-080, F-PRG-090, F-KAP-060, F-BEN-100 | Auftraggeber, Kasse und Flight Line | UI-/Prognosekonzept von BP-06/BP-07 | BP-06, BP-07 |
| OQ-06 | Muss jede Verarbeitung personenbezogener Daten einschließlich Worker-Ausführung und Push-Verarbeitung nachweislich in der EU erfolgen, oder genügt EU-Jurisdiktion der persistenten Daten? | Q-DSG-040, T-030 | Auftraggeber und Datenschutzverantwortlicher | Cloudflare-Ressourcenfreigabe/BP-11 | BP-02, BP-07, BP-11 |
| OQ-07 | Welche Aufbewahrungsfristen gelten für nicht personenbezogene Ticket-, Flug-, Prognose- und Audit-Historie, und welche gesetzlichen oder vereinsinternen Löschsperren gelten? | F-HIS-010, F-HIS-020, F-HIS-060, Q-DSG-020 | Auftraggeber und Datenschutzverantwortlicher | Datenmodell von BP-10 | BP-10, BP-11 |
| OQ-08 | Wie werden Papierverkäufe, Aufrufe und Umlaufereignisse nach einem Totalausfall wieder eingepflegt, in welcher Reihenfolge, durch welche Rolle und mit welcher Kennzeichnung als nacherfasst? | Q-ZUV-070, T-050, F-EVT-010, F-HIS-020 | Auftraggeber, Kasse, Leiter Flight Line und IT-Betrieb | Betriebsabnahme von BP-11 | BP-09, BP-11, BP-12 |
| OQ-09 | Welche Gewichtsklassen und Referenzwerte sind beim ersten Produktiveinsatz je Produkt aktiv, und mit welchem konkreten Ablauf wird das 15-Sekunden-Ziel bei aktivierter Erfassung abgenommen? | F-KAS-010, F-KAS-030, F-KAS-110, F-ADM-010 | Auftraggeber und Kasse | Verkaufskonzept von BP-04 | BP-04, BP-12 |
| OQ-10 | Welche Ticketausgabe wird beim ersten Produktiveinsatz verbindlich verwendet: vorgedruckte Codes, druckbares/digitales Ticket oder beide? Welche Ausgabe gilt als Fallback? | F-KAS-050 | Auftraggeber und Kasse | Verkaufskonzept von BP-04 | BP-04, BP-11 |
| OQ-11 | Welche Mindesthardware und konkret unterstützten Browserstände werden für Generalprobe und Abnahme festgelegt? | T-020, T-040, Q-UX-060, Q-ZUV-050 | Auftraggeber und IT-Betrieb | Testplanung von BP-12 | BP-07, BP-12 |
| OQ-12 | Welche fachliche Priorität und Bedienerentscheidung gilt, wenn Offline- oder parallele Kommandos aus Kasse, Flight Line und Administration miteinander in Konflikt stehen? | Q-ZUV-040, F-EVT-020, F-ADM-020, F-INT-070 | Auftraggeber, Kasse und Leiter Flight Line | Konfliktmodell von BP-09 | BP-02, BP-09 |

## Entscheidungsprotokoll

Noch keine der oben aufgeführten Fragen ist entschieden. Beschlüsse werden hier ergänzt und anschließend
in Traceability, Backlog, ADRs und Tests nachvollziehbar referenziert.

## Entscheidungsvorschlag vom 11.07.2026

Die folgenden Antworten sind ein konsistenter V1-Vorschlag, aber noch **kein Beschluss**. Die in der
Tabelle genannten verantwortlichen Rollen müssen ihn freigeben. Bis dahin dürfen Implementierung und
Tests diese Werte nur als synthetische Abnahmekonfiguration verwenden.

| Nr. | Empfohlene V1-Entscheidung |
|---|---|
| OQ-01 | Offline werden nur vorbereitende, lokal reversible Eingaben angenommen. Verkauf, Storno, Umbuchung, `NEXT`, `IM FLUG`, `GELANDET`, `ABGESCHLOSSEN`, Not-Halt und Stammdatenänderungen benötigen eine Serverbestätigung. Nicht bestätigte Eingaben heißen sichtbar „ausstehend“ und entfalten keine operative oder öffentliche Wirkung. |
| OQ-02 | Zehn Sekunden rückgängig: `NEXT`, Zurückstellen/No-Show-Markierung und lokale Eingaben vor Serverbestätigung. Korrekturereignisse: `CALL_REVOKED`, `QUEUE_POSITION_RESTORED`, `NO_SHOW_REVOKED`. Verkauf wird storniert, nicht gelöscht; `IM FLUG`, `GELANDET`, `ABGESCHLOSSEN`, Not-Halt, Storno, Umbuchung und Stammdatenänderungen sind nicht per Sofort-Undo rückgängig. Liegt ein Folgeereignis vor, wird Undo abgelehnt und ein rollenberechtigter Korrekturablauf verlangt. |
| OQ-03 | Teilung nur, wenn die gesamte Buchungsgruppe nicht in einen einzelnen kompatiblen Umlauf passt oder die Gruppe dies ausdrücklich wünscht. Kasse darf die Teilung beim Verkauf nach deutlichem Hinweis bestätigen; im Betrieb bestätigen Leiter Flight Line oder Administrator. Teilgruppen erhalten dieselbe Gruppen-ID, eine Teilgruppenkennung und unmittelbar aufeinanderfolgende Queue-Priorität; automatische Teilung bleibt verboten. |
| OQ-04 | Ja, bis unmittelbar vor `IM FLUG`: Das System darf nach `NEXT` nur einen kompatiblen Umbesetzungsvorschlag erzeugen. Flight-Line-Personal darf vorschlagen, Leiter Flight Line oder Administrator bestätigt. Slotnummer, Gruppenbindung, öffentlicher Status und veröffentlichtes Zeitfenster bleiben stabil; Flugzeugkennung wird öffentlich nicht gezeigt. |
| OQ-05 | Drei Qualitätsstufen: „stabil“ (intern ±5 min, öffentlich 10-min-Fenster), „veränderlich“ (intern ±10 min, öffentlich 20-min-Fenster) und „unsicher“ (kein Countdown; Warteposition plus „Betrieb verzögert – bitte Status erneut prüfen“). Ab Stufe „veränderlich“ keine minutengenaue Aussage; bei Pause, Unterbrechung, Notfall, fehlender aktiver Kapazität oder Datenalter über 5 min stets „unsicher“. Kasse und Flight Line sehen Ursache/Datenalter, öffentliche Ansichten nur handlungsorientierte Formulierungen. |
| OQ-06 | Die MUSS-Anforderung wird streng ausgelegt: auch Worker-/TLS-/Push-Verarbeitung und personenbeziehbare Metadaten innerhalb der EU. Produktionsfreigabe nur mit nachgewiesener EU-Regionalisierung aller beteiligten Dienste, AVV/DPA und dokumentierter Subprozessorprüfung. Falls das Kostenlimit dies ausschließt, ist vor Produktion eine formale Anforderungsänderung nötig; EU-Jurisdiktion nur für persistente Daten genügt nicht. |
| OQ-07 | Personenbezogene Benachrichtigungsdaten: Standard sieben Tage nach Veranstaltungsende gemäß Q-DSG-020. Operative Ticket-/Flug-/Prognosedaten: fünf Jahre, danach Löschung oder irreversibel aggregierte Statistik. Audit- und abrechnungsrelevante Tagesberichte: acht Jahre, soweit sie Buchungsbelege sind; sonst sechs Jahre. Eine dokumentierte Löschsperre setzt Löschung nur für den betroffenen Datensatz und Zeitraum aus. Rechtliche Prüfung durch Steuerberatung/Datenschutz bleibt Freigabebedingung. |
| OQ-08 | Nacherfassung erfolgt nach Wiederanlauf ausschließlich durch Kasse (Papierverkäufe) und Leiter Flight Line/Administrator (Aufrufe und Umlaufereignisse) über einen eigenen Importablauf. Reihenfolge ist tatsächliche Ereigniszeit, bei Gleichstand Papier-Belegfolge; jede Eingabe trägt `recordedAfterOutage=true`, ursprüngliche Zeit, Nacherfasser-Gerät und Belegreferenz ohne Gastnamen. Vor Commit zeigt eine Simulation Konflikte; stale oder logisch unmögliche Folgen werden nicht automatisch zusammengeführt. Vier-Augen-Abschluss durch Administrator. |
| OQ-09 | Abnahmekonfiguration: Gewichtserfassung standardmäßig aus. Für den Test aktiv: Kind, Normal, Schwer, Individuell; Grenz-/Referenzwerte sind veranstaltungs- bzw. produktbezogene Konfiguration und besitzen keine Freigabewirkung. Das 15-Sekunden-Ziel wird mit 30 Standardverkäufen nach höchstens zehn Minuten Einweisung gemessen; Median unter 15 s, mindestens 27/30 unter 15 s, keine Fehlbuchung. Produktive Werte werden vom Betreiber vor Generalprobe eingetragen. |
| OQ-10 | Beide V1-Ausgaben werden unterstützt. Primär: vorgedruckter, kryptografisch zufälliger QR-Code, den die Kasse scannt und aktiviert. Sekundär: systemerzeugtes druckbares/digitales Ticket. Papierfallback bei Totalausfall: fortlaufend kontrollierte vorgedruckte Codes mit späterer Nacherfassung. |
| OQ-11 | Abnahmebasis: Tablets ab 10 Zoll/1920×1200 bzw. iPad ab 10,2 Zoll, Windows-PC ab 1366×768, 4 GB RAM, Kamera für Kassen-/Flight-Line-Geräte; jeweils letzte und vorletzte Hauptversion von Chrome, Edge und Safari zum Zeitpunkt der Generalprobe. Kiosk-Gerät mit automatischem Vollbildstart und WebSocket-Unterstützung. Die konkrete Hardwareliste wird vier Wochen vor Generalprobe eingefroren. |
| OQ-12 | Es gibt keine automatische fachliche Gewinnerrolle. Der Event-Durable-Object serialisiert nach Servereingang; erwartete Version und Invarianten entscheiden. Der erste gültige Schreibbefehl gewinnt technisch, jeder stale Konflikt wird sichtbar abgelehnt. Not-Halt hat einen eigenen autorisierten Sofortpfad, überschreibt aber keine Historie. Konflikte werden durch Leiter Flight Line für operative Abläufe, Kasse für noch nicht operative Verkäufe und Administrator für Stammdaten/Korrekturen neu entschieden und als neues Kommando protokolliert. |

### Begründungsnachweise für OQ-06 und OQ-07

- Cloudflare Durable-Object-Jurisdiktion `eu` begrenzt nur Ausführung und Persistenz des Durable
  Objects; Worker-Zugriffe und bestimmte Logs können außerhalb liegen:
  <https://developers.cloudflare.com/durable-objects/reference/data-location/>
- TLS-/Request-Verarbeitung und Metadaten benötigen Regional Services und Customer Metadata Boundary;
  die Data Localization Suite ist ein Enterprise-Zusatz:
  <https://developers.cloudflare.com/data-localization/>
- Cloudflare-DPA/SCC müssen vertraglich geprüft werden:
  <https://www.cloudflare.com/en-gb/cloudflare-customer-dpa/>
- § 147 Abs. 3 AO nennt aktuell acht Jahre für Buchungsbelege und sechs Jahre für sonstige dort
  aufgeführte Unterlagen: <https://www.gesetze-im-internet.de/ao_1977/__147.html>
- Datenschutzrechtliche Speicherfristen müssen auf das erforderliche Mindestmaß begrenzt werden:
  <https://www.bfdi.bund.de/SharedDocs/Downloads/DE/DokumenteBfDI/AccessForAll/2023/2021_Loeschkonzept-BfDI.pdf?__blob=publicationFile&v=2>

## Freigabeprotokoll

| Datum | Status | Verantwortliche Rolle | Umfang und Begründung |
|---|---|---|---|
| 11.07.2026 | freigegeben | Auftraggeber | OQ-01 bis OQ-05 und OQ-07 bis OQ-12 gemäß Entscheidungsvorschlag vom 11.07.2026. |
| 11.07.2026 | freigegeben | Auftraggeber und Datenschutzverantwortlicher | OQ-06 gemäß Entscheidungsvorschlag: namens- und telefonnummernfreier, rein ID-basierter Kern; freiwilliges ticketbezogenes Web-Push bleibt erhalten. Die Verarbeitung ist damit datensparsam und pseudonym, nicht vollständig anonym. Q-DSG-040 wird streng ausgelegt; Produktionsfreigabe erfordert nachgewiesene EU-Verarbeitung einschließlich Push- und Netzwerkmetadaten. |
| 11.07.2026 | freigegeben | Auftraggeber | V1 erfasst abweichend von F-KAS-040 und D-030 keinerlei Telefonnummern, auch nicht optional. Telefonnummern-, SMS- und Messenger-basierte Benachrichtigung ist nicht Bestandteil von V1. Der Gast ruft seinen Status ausschließlich über einen nicht erratbaren QR-/Ticketcode in Webseite oder PWA ab. Die binären Referenzanforderungen bleiben unverändert; die Änderung ist in der nächsten konsolidierten Anforderungsversion nachzuführen. |
| 11.07.2026 | freigegeben | Auftraggeber | Freiwilliges Web-Push je Ticket in der PWA bleibt Bestandteil von V1 (F-BEN-020, F-BEN-040, D-110 und Q-DSG-020/Q-DSG-030). Push-Abonnement und Einwilligung werden strikt vom operativen Ticketkern getrennt, zweckgebunden gespeichert und fristgerecht gelöscht. |

### Abgrenzung zur gewünschten Anonymität

Keine Gastnamen und persönliche Helferkonten zu speichern bleibt verbindlich. Zufällige Ticket-,
Gruppen- und Geräte-IDs sind jedoch nur dann anonym, wenn eine Person mit keinem Mittel, das
vernünftigerweise eingesetzt werden kann, identifizierbar ist. Solange ein Ticketcode mit seinem
Inhaber, eine Push-Registrierung mit einem Browser oder eine Telefonnummer mit einer Person verknüpft
werden kann, handelt es sich mindestens um pseudonymisierte und damit weiterhin personenbezogene Daten.

- EDSA zur Abgrenzung: <https://www.edpb.europa.eu/sme-data-protection-guide/faq-frequently-asked-questions/answer/what-difference-between_en>
- EDSA: pseudonymisierte Daten bleiben personenbezogene Daten:
  <https://www.edpb.europa.eu/news/edpb-adopts-pseudonymisation-guidelines-and-paves-the-way-to-improve-cooperation-with_en>
- EuGH zu Identifikationsnummern, Online-Kennungen und Erwägungsgrund 26:
  <https://eur-lex.europa.eu/legal-content/en/TXT/?uri=CELEX%3A62021CJ0683>
