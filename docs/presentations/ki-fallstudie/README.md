# KI-Fallstudie zum Rundflug-Leitstand

Dieser Ordner enthält die druckfertige Präsentation zur Entstehung des Rundflug-Leitstands. Sie wird als HTML/CSS gepflegt und reproduzierbar als PDF ausgegeben. Der dokumentierte Stand ist der 14. August 2026.

## Inhalt

- `index.html` und `styles.css`: editierbare Präsentationsquelle im Format 16:9.
- `render.cjs`: lokaler PDF-Renderer mit Bild- und Folienzahl-Prüfung.
- `rundflug-leitstand-ki-fallstudie.pdf`: finale Ausgabe mit 27 Hauptfolien und 14 vertiefenden Anhangsfolien.
- `assets/live/`: reale Screenshots der aktuellen Dark-Theme-Oberflächen, der Gast-PWA und der iOS-Push-Nachrichten.
- `assets/simulator/`: Screenshots des Simulators und seiner Auswertungen mit synthetischen Daten.
- `assets/sonarqube/`: SonarQube-Nachweise zum Weg von 778 bewerteten Findings zu null offenen Issues und einem bestandenen Quality Gate.
- `assets/ux/`: fünf historische UX/UI-Stände, die vor dem Entfernen der früheren PowerPoint-Datei als eigenständige Projektnachweise gesichert wurden.

Die Hauptdramaturgie bleibt bewusst klar und präsentationsfähig. Die Folie „Gestalterische Konsequenz“ erklärt dieses Prinzip ausdrücklich: große Beweisbilder und eindeutige Aussagen im Hauptteil, höhere technische und methodische Detailtiefe im Anhang.

## PDF erzeugen

Nach `npm install` im Repository-Root kann die Ausgabe aus diesem Ordner erzeugt werden:

```powershell
node render.cjs
```

Optional schreibt `PREVIEW_DIR` zusätzlich jede Folie als PNG für die visuelle Prüfung. Der Renderer nutzt lokal Microsoft Edge über Playwright und bricht bei fehlenden Bildern oder abweichender Folienzahl ab. Textfluss, Abstände und mögliche Überlagerungen werden an den gerenderten PDF-Seiten visuell geprüft.

## Bewusst nicht dupliziert

Die Präsentation verweist auf die kanonischen Quellen, statt sie nochmals abzulegen:

- Architektur und Mermaid-Diagramme: [`docs/arc42/`](../../arc42/)
- Architekturentscheidungen: [`docs/adr/`](../../adr/)
- Engineering- und Integrationsprozess: [`AGENTS.md`](../../../AGENTS.md)
- Anforderungen und Traceability: [`docs/requirements/`](../../requirements/)

Vorhandene Live-, Simulator- und SonarQube-Bilder werden direkt aus ihren bestehenden Ordnern verwendet. Nur die fünf historischen UX/UI-Stände wurden ergänzt, weil sie zuvor ausschließlich in der nun entfernten PowerPoint-Datei eingebettet waren.

## Einordnung

Die Screenshots dokumentieren einen Demonstrationsstand mit synthetischen Veranstaltungs-, Ticket- und Betriebsdaten. Aussagen zu menschlichem und hypothetischem manuellem Aufwand sind als Schätzungen gekennzeichnet. Anforderungen, ADRs, arc42 und Tests bleiben die fachlichen und technischen Quellen der Wahrheit.
