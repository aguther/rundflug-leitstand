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
