# Wirklich offene Freigaben – Release 1.10.0

Alle fachlichen V1-Entscheidungen sind in `requirements-v1.10.0.md`, gültigen ADRs und Tests
konsolidiert. Offen sind nur noch externe oder betreiberseitige Freigaben:

| ID | Offene Freigabe | Verantwortlich | Produktionswirkung |
| --- | --- | --- | --- |
| OQ-06 | Nachweis, dass Worker-/TLS-/Push-Verarbeitung und personenbeziehbare Metadaten die strenge EU-Anforderung Q-DSG-040 erfüllen; einschließlich DPA/AVV und Subprozessorprüfung. | Datenschutz und Betreiber | Produktion bleibt gesperrt. |
| OQ-13 | Nutzungsrecht, endgültiger Projektlizenztext und unterschriebenes Übergabeprotokoll. | Berechtigte Parteien | Betreiberübergabe bleibt formal offen. |
| OQ-14 | Konkrete Hardwareliste und unterstützte Browserstände vier Wochen vor Generalprobe einfrieren. | Auftraggeber und IT-Betrieb | Generalprobe bleibt offen. |

Datenschutz-, Hardware-, Helfer- und Produktionsabnahme bleiben manuelle Gates. Sie dürfen nicht
durch technische Tests oder ein erfolgreiches Deployment ersetzt werden.

## Geklärte Anforderungskonkretisierung

| ID | Entscheidung | Geklärt durch | Ergebnis |
| --- | --- | --- | --- |
| OQ-15 | Darf der öffentliche Statuskatalog aus F-BEN-090 um einen ortsneutralen Vorstatus zwischen WARTEN und GO TO GATE ergänzt werden? | Auftraggeber, 2026-07-28; ADR-0029 | Ja. `PREPARE` wird als `BEREITHALTEN` mit ausdrücklichem Hinweis „noch nicht zum Gate kommen“ geführt. Die übrigen Zustände und ihre Handlungswirkung bleiben unverändert. |
