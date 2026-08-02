# Wirklich offene Freigaben – Release 1.12.0

Die bis Release 1.11.0 freigegebenen fachlichen V1-Entscheidungen bleiben unverändert. Die zehn
geplanten Anforderungen aus `requirements-v1.12.0.md`, ADR-0034 und das UI-Konzept für Analyse und
Diagnose werden in WP0 zur Freigabe vorgelegt; vor dieser Freigabe beginnt kein produktiver
Umsetzungsschritt aus WP1 bis WP4.

| ID | Offene Freigabe | Verantwortlich | Produktionswirkung |
| --- | --- | --- | --- |
| OQ-06 | Nachweis, dass Worker-/TLS-/Push-Verarbeitung und personenbeziehbare Metadaten die strenge EU-Anforderung Q-DSG-040 erfüllen; einschließlich DPA/AVV und Subprozessorprüfung. | Datenschutz und Betreiber | Produktion bleibt gesperrt. |
| OQ-13 | Nutzungsrecht, endgültiger Projektlizenztext und unterschriebenes Übergabeprotokoll. | Berechtigte Parteien | Betreiberübergabe bleibt formal offen. |
| OQ-14 | Konkrete Hardwareliste und unterstützte Browserstände vier Wochen vor Generalprobe einfrieren. | Auftraggeber und IT-Betrieb | Generalprobe bleibt offen. |
| OQ-17 | Release 1.12.0 sowie Wortlaut und IDs `V1120-DIA-010` bis `V1120-QA-010` als verbindliche nächste Releaseanforderungen freigeben. | Auftraggeber | WP1 bis WP4 und die Integration von WP0 nach `main` bleiben gesperrt. |
| OQ-18 | Produktionswert für `ANALYSIS_RETENTION_DAYS` innerhalb `14..365` festlegen; Empfehlung: Entwicklung und Abnahme 30 Tage, Produktion nur mit ausdrücklich freigegebenem Wert. | Auftraggeber, Datenschutz und Betreiber | Produktive Archivierung bleibt gesperrt; Entwicklung darf mit 30 Tagen erfolgen. |
| OQ-19 | ADR-0034 und `docs/ui/analysis-export-concept.md` einschließlich Rollen, Support-sicherem Profil, R2-Präfix, Closed-Day-Grenze und Flight-Director-Diagnoseaktion freigeben. | Auftraggeber, Datenschutz und Betrieb | Produktiver Code und UI-Implementierung aus WP1 bis WP4 bleiben gesperrt. |

Datenschutz-, Hardware-, Helfer- und Produktionsabnahme bleiben manuelle Gates. Sie dürfen nicht
durch technische Tests oder ein erfolgreiches Deployment ersetzt werden.

## Geklärte Anforderungskonkretisierung

| ID | Entscheidung | Geklärt durch | Ergebnis |
| --- | --- | --- | --- |
| OQ-15 | Darf der öffentliche Statuskatalog aus F-BEN-090 um einen ortsneutralen Vorstatus zwischen WARTEN und GO TO GATE ergänzt werden? | Auftraggeber, 2026-07-28; ADR-0029 | Ja. `PREPARE` wird als `BEREITHALTEN` mit ausdrücklichem Hinweis „noch nicht zum Gate kommen“ geführt. Die übrigen Zustände und ihre Handlungswirkung bleiben unverändert. |
| OQ-16 | Darf `PREPARE/BEREITHALTEN` statt der ortsneutralen Abgrenzung aus OQ-15 ausdrücklich den Aufenthalt in der Nähe des Gates anweisen? | Auftraggeber, 2026-07-28; ADR-0029 | Ja. Die öffentliche Beschreibung lautet „Ihr Aufruf steht bevor. Bitte halten Sie sich in der Nähe des Gates bereit.“ Erst der weiterhin getrennte Zustand `COME_TO_FLIGHT_LINE` fordert mit `BITTE ZUM GATE` zum direkten Gang zum Gate auf; `BOARDING` bestätigt anschließend den begonnenen Einstieg. OQ-16 ersetzt ausschließlich die Copy- und Ortsneutralitätsentscheidung aus OQ-15. |
