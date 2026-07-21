# Codex-Prompt 01 – Plan und Traceability

```text
Arbeite im Plan-Modus.

Ziel:
Bereite das Repository "rundflug-leitstand" für die kontrollierte Umsetzung der Ausbaustufe V1 vor.
Schreibe noch keinen Feature-Code.

Kontext:
- Lies AGENTS.md.
- Lies zuerst `docs/requirements/requirements-v1.7.0.md` und `.yaml`, danach die fortgeltenden
  Basiskataloge V1.4/V1.5.
- Prüfe die binären PDF-/DOCX-Referenzen nur bei Unklarheiten.
- Die Anforderungs-IDs müssen unverändert bleiben.
- Die technische Zielarchitektur ist Cloudflare Worker + Static Assets + D1 + Durable Object + R2.

Aufgaben:
1. Prüfe `requirements-v1.7.0.yaml`, `traceability-v1.7.0.csv` und die Basiskataloge auf
   Vollständigkeit, Duplikate und fehlerhafte IDs.
2. Ergänze docs/requirements/open-questions.md um fachliche Widersprüche und fehlende Übergangsregeln.
3. Erzeuge beziehungsweise aktualisiere eine technische Risikoliste.
4. Prüfe die ADRs auf Widerspruch zu den Anforderungen.
5. Erzeuge einen priorisierten V1-Backlog aus vertikalen, überprüfbaren Arbeitspaketen.
6. Ordne jedem Arbeitspaket die betroffenen Anforderungs-IDs zu.
7. Schlage ein durchgängiges erstes Vertical Slice vor.
8. Dokumentiere Annahmen; entscheide keine blockierende Fachfrage eigenmächtig.

Einschränkungen:
- Kein Produktiv-Feature-Code.
- Keine Anforderungs-ID umbenennen.
- Keine fachliche Regel stillschweigend ändern.
- Maximal 12 blockierende Fragen in der ersten Fragerunde.
- Verwende die realen npm-Befehle dieses Repositories, nicht pnpm.

Fertig, wenn:
- jede V1-MUSS-Anforderung in der Traceability-Matrix vorkommt,
- keine ID doppelt oder ausgelassen ist,
- Risiken und offene Fragen dokumentiert sind,
- ein priorisierter Vertical-Slice-Backlog vorliegt,
- npm run requirements:verify erfolgreich ist,
- noch kein Feature-Code geschrieben wurde.
```
