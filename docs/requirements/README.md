# Anforderungsunterlagen

- `Lastenheft_Rundflug-Leitstand_v1.4_konsolidiert.pdf` und `.docx` sind unveränderte Referenzen.
- `requirements-v1.4.md` ist die fortgeschriebene Markdown-Fassung. Sie übernimmt freigegebene
  Auftraggeberentscheidungen aus den ADRs, ohne die binären Referenzen zu verändern.
- `requirements-v1.4.yaml` enthält dieselben 207 Anforderungen strukturiert und konsolidiert.
- `requirements-v1.5.md` und `.yaml` enthalten die freigegebene Feedback-Ausbaustufe. Sie
  konkretisieren und überstimmen bei Widersprüchen die V1.4-Fassung.
- `requirements-v1.6.0.md` und `.yaml` beschreiben den zum Applikationsrelease `1.6.0` gehörenden
  Kassen- und Druckumfang. Die vollständige Releaseversion ist für Anwendung, Requirements,
  Traceability und UI-Referenzen identisch.
- `requirements-v1.6.1.md` und `.yaml` ergänzen die kompatible Renderingkorrektur für iPad und
  Desktop. Sie sind die aktuelle Releasefassung und übernehmen im Übrigen V1.6.0 unverändert.
- `traceability.csv` verbindet Anforderungen später mit Issues, Modulen und Tests.
- `open-questions.md` enthält noch zu entscheidende Fachfragen.

Die Unterlagen sind vertraulich. Bei Abweichungen haben die freigegebenen fachlichen Entscheidungen
in den ADRs Vorrang vor älteren Texten der binären Referenz; jede Abweichung muss dokumentiert sein.

## Versionierung

Die Version im Root-`package.json` ist die Source of Truth. Neue Funktionen erhöhen mindestens die
Minorversion, reine kompatible Fehlerkorrekturen die Patchversion. `npm run requirements:verify`
lehnt einen Repository-Stand ab, wenn Workspace-Pakete, Laufzeitmetadaten oder aktuelle
Requirements-/Traceability-Dokumente davon abweichen.
