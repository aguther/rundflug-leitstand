# Architekturdokumentation (arc42)

Diese Dokumentation beschreibt die Architektur des **Rundflug-Leitstands** nach der Gliederung
[arc42](https://arc42.org/). Beschrieben ist der tatsächlich implementierte Stand der
Anwendungsversion **1.12.0** (Cloudflare-Abnahmeumgebung, noch nicht produktiv freigegeben).

Fachlich maßgeblich bleiben der Anforderungskatalog `docs/requirements/requirements-v1.12.0.md`, die
freigegebenen ADRs unter `docs/architecture/adr/` und die automatisierten Prüfungen. Diese
Dokumentation fasst zusammen, ordnet ein und verweist – sie ersetzt keine dieser Quellen.

## Kapitel

| Kapitel | Inhalt |
| --- | --- |
| [1. Einführung und Ziele](01-einfuehrung-und-ziele.md) | Aufgabenstellung, Qualitätsziele, Stakeholder |
| [2. Randbedingungen](02-randbedingungen.md) | technische, organisatorische und konventionelle Vorgaben |
| [3. Kontextabgrenzung](03-kontextabgrenzung.md) | fachlicher und technischer Systemkontext |
| [4. Lösungsstrategie](04-loesungsstrategie.md) | Leitentscheidungen, Zerlegung, verworfene Alternativen |
| [5. Bausteinsicht](05-bausteinsicht.md) | Workspace, Worker, Webanwendung, Fachlogik, Kommandopipeline |
| [6. Laufzeitsicht](06-laufzeitsicht.md) | Verkauf, Umlauf, Prognose, Reconnect, öffentlicher Status, Cron |
| [7. Verteilungssicht](07-verteilungssicht.md) | Infrastruktur, Umgebungen, Konfiguration, Deployment |
| [8. Querschnittliche Konzepte](08-querschnittliche-konzepte.md) | Domänenmodell, Konsistenz, Sicherheit, Datenschutz, Betrieb |
| [9. Architekturentscheidungen](09-architekturentscheidungen.md) | Übersicht aller ADRs und offener Entscheidungen |
| [10. Qualitätsanforderungen](10-qualitaetsanforderungen.md) | Qualitätsbaum und prüfbare Szenarien |
| [11. Risiken und technische Schulden](11-risiken-und-technische-schulden.md) | priorisierte Risiken und Restschulden |
| [12. Glossar](12-glossar.md) | fachliche und technische Begriffe |

## PDF erzeugen

Nach der einmaligen Installation der Repository-Abhängigkeiten erzeugt ein Befehl die
PDF-Gesamtfassung:

```bash
npm run docs:arc42:pdf
```

Der Befehl stellt bei Bedarf den zum Projekt gehörenden Playwright-Chromium bereit, bündelt die
Kapitel, fügt die ADR-Quelldokumente als Anhang an, rendert alle Mermaid-Diagramme mit der exakt
gepinnten lokalen Mermaid-Version und erzeugt ein druckfertiges A4-PDF mit Titelblatt, verlinktem
Inhaltsverzeichnis, Kopf- und Fußzeilen sowie Seitenzahlen. Pandoc, LaTeX, Docker und ein
ungepinnter `npx`-Download werden nicht benötigt.

Ergebnisse:

- `output/arc42/rundflug-leitstand-arc42.md` – gebündeltes Markdown mit Metadaten.
- `output/pdf/rundflug-leitstand-arc42.pdf` – druckfertige PDF-Fassung.

Mit `npm run docs:arc42:bundle` lässt sich nur das gebündelte Markdown erzeugen. Relative Links
werden darin repository-relativ umgeschrieben. Der PDF-Build verwendet interne Links auf die ADRs im
Anhang und dauerhaft klickbare Links auf sonstige referenzierte Dateien im `main`-Branch des
GitHub-Repositories. Die erzeugten Dateien sind abgeleitete Artefakte unter `output/` und werden
nicht versioniert oder committed.

## Pflege

```bash
npm run docs:arc42:check
```

Die Prüfung ist Teil von `npm run docs:verify` und damit von `npm run check`. Sie stellt sicher, dass
alle zwölf Kapitel vorhanden sind, die arc42-Überschrift tragen, im obigen Inhaltsverzeichnis
verlinkt sind und gültige, nicht leere Mermaid-Blöcke enthalten. `scripts/verify_architecture_docs.mjs`
prüft zusätzlich, dass alle lokalen Links dieser Dokumentation auf vorhandene Dateien zeigen.

Regeln für Änderungen:

- Architekturentscheidungen werden zuerst als ADR unter `docs/architecture/adr/` festgehalten und hier nur
  zusammengefasst.
- Der implementierte Architekturstand wird ausschließlich in diesen arc42-Kapiteln gepflegt.
  Zukunftskonzepte und aktuelle technische Schulden liegen getrennt unter
  `docs/architecture/concepts/` und `docs/architecture/technical-debts/`.
- Diagramme werden als Mermaid-Quelltext gepflegt, nicht als eingebettete Bilddateien.
- Neue Kapitel oder Umbenennungen erfordern eine Anpassung von `scripts/verify_arc42_docs.mjs`.
