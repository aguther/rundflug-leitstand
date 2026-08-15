# KI-Fallstudie zum Rundflug-Leitstand

Dieser Ordner enthält die druckfertige Präsentation zur Entstehung des Rundflug-Leitstands. Sie wird als HTML/CSS gepflegt und reproduzierbar als PDF ausgegeben. Der dokumentierte Stand ist der 15. August 2026.

## Inhalt

- `index.html` und `styles.css`: editierbare Präsentationsquelle im Format 16:9.
- `render.cjs`: lokaler PDF-Renderer mit Bild-, Mermaid-, Folienzahl- und Layoutprüfung.
- `rundflug-leitstand-ki-fallstudie.pdf`: finale Ausgabe mit 22 Hauptfolien und 18 vertiefenden Anhangsfolien.
- `assets/live/`: reale Screenshots der aktuellen Dark-Theme-Oberflächen, der Gast-PWA und der iOS-Push-Nachrichten.
- `assets/simulator/`: Screenshots des Simulators und seiner Auswertungen mit synthetischen Daten.
- `assets/sonarqube/`: SonarQube-Nachweise zum Weg von 778 bewerteten Findings zu null offenen Issues und einem bestandenen Quality Gate.
- `assets/ux/`: fünf historische UX/UI-Stände, die vor dem Entfernen der früheren PowerPoint-Datei als eigenständige Projektnachweise gesichert wurden.

## Dramaturgie

Der rund 30-minütige Hauptteil folgt der Gliederung **Why – How – What**:

- **Why** (Folien 1–4): konkreter Anlass beim Jubiläums-Rundflugbetrieb, operative Engpässe und das Ziel eines gemeinsamen Lagebilds.
- **How** (Folien 5–12): Vorarbeit vor dem ersten Commit, 34-Tage-Verlauf, Rollenteilung zwischen Mensch und KI, UX-Freigaben, der zweistündige Simulator-Impuls, Live-Debugging, Frustmomente und kontrollierte parallele Integration.
- **What** (Folien 13–20): Produktkarton, aktuelle Live-Ansichten, QR/PWA/Push, Prognose und Simulator sowie originale arc42-Architektur und Engineering-Evidenz.
- **Fazit** (Folien 21–22): getrennte Einordnung von Kalenderzeit, menschlichem Aufwand und manueller Vergleichsschätzung sowie eine nüchterne Bilanz.
- **Anhang** (A1–A18): Quellenmethode, Produkt- und Architekturdetails, originale Mermaid-Diagramme, ADR- und AGENTS-Beispiele, Testinventar, SonarQube-Nachweise und Aufwandsschätzung.

Die Reibungspunkte zitieren reale Prompts aus dem Projektverlauf. Rekonstruierte Beobachtungen – etwa das gemeinsame Live-Debugging eines durch einen Adblocker beeinflussten Mobilproblems – sind ausdrücklich als Projektrückblick markiert. Sie sind bewusst Teil des Hauptteils, weil sie die Grenzen fehlenden Kontexts konkret machen.

Die Formulierungen sind auf eine nüchterne, nachprüfbare Darstellung ausgelegt. Aussagen zu Aufwand und Vergleichsgrößen sind als Schätzung gekennzeichnet und im Anhang hergeleitet. Interne Gestaltungsprinzipien werden nicht als eigene Folie gezeigt; technische und methodische Vertiefungen stehen im Anhang.

## PDF erzeugen

Nach `npm install` im Repository-Root kann die Ausgabe aus diesem Ordner erzeugt werden:

```powershell
node render.cjs
```

Optional schreibt `PREVIEW_DIR` zusätzlich jede Folie als PNG für die visuelle Prüfung. Der Renderer nutzt lokal Microsoft Edge über Playwright und bricht bei fehlenden Bildern, fehlenden Mermaid-Quellen, abweichender Folienzahl, überlaufenden Prüfflächen oder Elementen außerhalb der 16:9-Seite ab. Zusätzlich werden alle PDF-Seiten gerendert und visuell geprüft.

## Bewusst nicht dupliziert

Die Präsentation bindet kanonische Quellen ein, statt sie nochmals abzulegen:

- Architektur und Mermaid-Diagramme: [`docs/arc42/`](../../arc42/)
- Architekturentscheidungen: [`docs/adr/`](../../adr/)
- Engineering- und Integrationsprozess: [`AGENTS.md`](../../../AGENTS.md)
- Anforderungen und Traceability: [`docs/requirements/`](../../requirements/)

Vier Architektur- und Laufzeitdiagramme werden beim PDF-Build unverändert aus ihren Mermaid-Quellblöcken unter `docs/arc42/` gelesen und gerendert. Dadurch bleiben arc42-Dokumentation und Präsentation inhaltlich identisch, ohne zusätzliche SVG- oder Bildkopien.

Vorhandene Live-, Simulator- und SonarQube-Bilder werden direkt aus ihren bestehenden Ordnern verwendet. Nur die fünf historischen UX/UI-Stände wurden ergänzt, weil sie zuvor ausschließlich in der nun entfernten PowerPoint-Datei eingebettet waren.

## Einordnung

Die Screenshots dokumentieren einen Demonstrationsstand mit synthetischen Veranstaltungs-, Ticket- und Betriebsdaten. Aussagen zu menschlichem und hypothetischem manuellem Aufwand sind als Schätzungen gekennzeichnet. Anforderungen, ADRs, arc42 und Tests bleiben die fachlichen und technischen Quellen der Wahrheit.
