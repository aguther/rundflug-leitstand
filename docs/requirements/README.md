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
- `requirements-v1.6.1.md` und `.yaml` ergänzen die kompatible Kassen-Renderingkorrektur sowie die
  kompakte, auch auf iPads nutzbare Flight Line.
- `requirements-v1.7.0.md` und `.yaml` beschreiben die aktuelle kompakte Kasse, den segmentweisen
  Aufruf aufgeteilter Gruppen, die QR-Scan-Vergrößerung, layoutneutrale schließbare Meldungen sowie
  die getrennte Assist-Auswahl und -Arbeitsansicht.
- `requirements-v1.7.1.md` und `.yaml` ergänzen die loginbasierte Flugzeugübernahme, den technischen
  Umlaufabbruch und die stabile kompakte Flight-Line-Bedienung.
- `requirements-v1.7.2.md` und `.yaml` dokumentieren die
  kompatiblen Fokus-, Kassen-, Tabellen-, Zeitlinien-, Abschluss- und Assist-Korrekturen und
  übernehmen im Übrigen V1.7.1 unverändert.
- `requirements-v1.7.3.md` und `.yaml` dokumentieren das
  geschützte Standard-FIDS, Display-Konten, langlebige Sitzungen, kontobezogene Einstellungen und
  die globale Handlungspriorität.
- `requirements-v1.8.0.md` und `.yaml` sind die aktuelle Releasefassung. Sie dokumentieren den
  einheitlichen Busy Indicator, absolute prognostizierte Zeitfenster, die freigegebenen
  Kassen-/Flight-Line-Deltas sowie einen öffentlichen Gruppen-QR-Code.
- `traceability.csv` verbindet Anforderungen später mit Issues, Modulen und Tests.
- `open-questions.md` enthält noch zu entscheidende Fachfragen.

Die Unterlagen sind vertraulich. Bei Abweichungen haben die freigegebenen fachlichen Entscheidungen
in den ADRs Vorrang vor älteren Texten der binären Referenz; jede Abweichung muss dokumentiert sein.

## Versionierung

Die Version im Root-`package.json` ist die Source of Truth. Neue Funktionen erhöhen mindestens die
Minorversion, reine kompatible Fehlerkorrekturen die Patchversion. `npm run requirements:verify`
lehnt einen Repository-Stand ab, wenn Workspace-Pakete, Laufzeitmetadaten oder aktuelle
Requirements-/Traceability-Dokumente davon abweichen.
