# Wirklich offene Freigaben – Release 1.12.0

Die bis Release 1.11.0 freigegebenen fachlichen V1-Entscheidungen bleiben unverändert. Die zehn
Anforderungen aus `requirements-v1.12.0.md`, ADR-0034 und das UI-Konzept für Analyse und Diagnose
wurden am 2026-08-02 durch den Auftraggeber freigegeben. Offen bleiben externe und
Produktionsfreigaben.

| ID | Offene Freigabe | Verantwortlich | Produktionswirkung |
| --- | --- | --- | --- |
| OQ-06 | Nachweis, dass Worker-/TLS-/Push-Verarbeitung und personenbeziehbare Metadaten die strenge EU-Anforderung Q-DSG-040 erfüllen; einschließlich DPA/AVV und Subprozessorprüfung. | Datenschutz und Betreiber | Produktion bleibt gesperrt. |
| OQ-13 | Nutzungsrecht, endgültiger Projektlizenztext und unterschriebenes Übergabeprotokoll. | Berechtigte Parteien | Betreiberübergabe bleibt formal offen. |
| OQ-14 | Konkrete Hardwareliste und unterstützte Browserstände vier Wochen vor Generalprobe einfrieren. | Auftraggeber und IT-Betrieb | Generalprobe bleibt offen. |
| OQ-18 | Produktionswert für `ANALYSIS_RETENTION_DAYS` innerhalb `14..365` festlegen; Empfehlung: Entwicklung und Abnahme 30 Tage, Produktion nur mit ausdrücklich freigegebenem Wert. | Auftraggeber, Datenschutz und Betreiber | Produktive Archivierung bleibt gesperrt; Entwicklung darf mit 30 Tagen erfolgen. |
| OQ-20 | Freigeben, dass verifizierte technische Planungshistorie nach tagesbezogenem R2-Archiv und erfolgreicher Replay-Probe eventweise aus der operativen D1 kompaktiert wird; Segmentintervall sowie Zeilen- und Byte-Schwellen für mehrtägige und parallele Veranstaltungen festlegen. | Auftraggeber, Datenschutz und Betreiber | Automatische D1-Kompaktierung bleibt bis zur Festlegung deaktiviert; Werksreset und Veranstaltungslöschung bleiben davon unberührt. |

Datenschutz-, Hardware-, Helfer- und Produktionsabnahme bleiben manuelle Gates. Sie dürfen nicht
durch technische Tests oder ein erfolgreiches Deployment ersetzt werden.

## Geklärte Anforderungskonkretisierung

| ID | Entscheidung | Geklärt durch | Ergebnis |
| --- | --- | --- | --- |
| OQ-17 | Release 1.12.0 sowie Wortlaut und IDs `V1120-DIA-010` bis `V1120-QA-010` als verbindliche nächste Releaseanforderungen freigeben. | Auftraggeber, 2026-08-02 | Ja. WP1 bis WP4 dürfen gemäß dem freigegebenen Hybridplan umgesetzt werden. |
| OQ-19 | ADR-0034 und `docs/ui/analysis-export-concept.md` einschließlich Rollen, Support-sicherem Profil, R2-Präfix, Closed-Day-Grenze und Flight-Director-Diagnoseaktion freigeben. | Auftraggeber, 2026-08-02 | Ja. ADR und UI-Konzept sind freigegeben; die Browserabnahme bleibt Teil der Definition of Done. |
| OQ-15 | Darf der öffentliche Statuskatalog aus F-BEN-090 um einen ortsneutralen Vorstatus zwischen WARTEN und GO TO GATE ergänzt werden? | Auftraggeber, 2026-07-28; ADR-0029 | Ja. `PREPARE` wird als `BEREITHALTEN` mit ausdrücklichem Hinweis „noch nicht zum Gate kommen“ geführt. Die übrigen Zustände und ihre Handlungswirkung bleiben unverändert. |
| OQ-16 | Darf `PREPARE/BEREITHALTEN` statt der ortsneutralen Abgrenzung aus OQ-15 ausdrücklich den Aufenthalt in der Nähe des Gates anweisen? | Auftraggeber, 2026-07-28; ADR-0029 | Ja. Die öffentliche Beschreibung lautet „Ihr Aufruf steht bevor. Bitte halten Sie sich in der Nähe des Gates bereit.“ Erst der weiterhin getrennte Zustand `COME_TO_FLIGHT_LINE` fordert mit `BITTE ZUM GATE` zum direkten Gang zum Gate auf; `BOARDING` bestätigt anschließend den begonnenen Einstieg. OQ-16 ersetzt ausschließlich die Copy- und Ortsneutralitätsentscheidung aus OQ-15. |
