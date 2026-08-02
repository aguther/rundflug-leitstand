# Anforderungsunterlagen

- `requirements-v1.12.0.md` und `.yaml` sind die einzige aktuelle Releasefassung. Sie
  konsolidieren alle fortgeltenden Anforderungen und ergänzen die zur Freigabe vorgelegten
  Anforderungen für Diagnose, Tagesanalyse und Offline-Replay.
- `Lastenheft_Rundflug-Leitstand_v1.4_konsolidiert.pdf` und `.docx` sind unveränderte Referenzen.
- `requirements-v1.4.md` ist die fortgeschriebene Markdown-Fassung. Sie übernimmt freigegebene
  Auftraggeberentscheidungen aus den ADRs, ohne die binären Referenzen zu verändern.
- `requirements-v1.4.yaml` enthält dieselben 207 Anforderungen strukturiert und konsolidiert.
- `requirements-v1.12.0.md` und `.yaml` enthalten alle 340 aktuell fortgeltenden beziehungsweise
  geplanten Anforderungen: den vollständigen Basiskatalog, 99 migrierte Deltas aus 1.5 bis 1.9.1,
  die Deltas 1.10.0 und 1.11.0 sowie die zehn geplanten Anforderungen aus 1.12.0.
- `traceability-v1.12.0.csv` ist die vollständige aktuelle Traceability; `traceability.csv` bleibt
  die maschinenlesbare Zuordnung des unveränderten Basiskatalogs.
- `open-questions.md` enthält ausschließlich noch ausstehende externe und Betreiberfreigaben.

Die Unterlagen sind vertraulich. Bei Abweichungen haben die freigegebenen fachlichen Entscheidungen
in den ADRs Vorrang vor älteren Texten der binären Referenz; jede Abweichung muss dokumentiert sein.

## Versionierung

Die Version im Root-`package.json` ist die Source of Truth. Neue Funktionen erhöhen mindestens die
Minorversion, reine kompatible Fehlerkorrekturen die Patchversion. `npm run requirements:verify`
lehnt einen Repository-Stand ab, wenn Workspace-Pakete, Laufzeitmetadaten oder aktuelle
Requirements-/Traceability-Dokumente davon abweichen.

`npm run docs:requirements:build` erzeugt den kumulativen Katalog und die aktuelle Traceability
deterministisch aus dem Basiskatalog, den konsolidierten Delta-Quellen unter `scripts/data/`, den
Releaseanforderungen 1.10.0 und 1.11.0 sowie
`scripts/data/requirements-delta-1.12.0.json`; `npm run docs:requirements:check` lehnt manuelle
Abweichungen ab. Release 1.12.0, ADR-0034 und das UI-Konzept wurden am 2026-08-02 durch den
Auftraggeber freigegeben; die Umsetzungsschritte WP1 bis WP4 dürfen beginnen.
