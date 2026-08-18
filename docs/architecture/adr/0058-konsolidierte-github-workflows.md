# ADR-0058: Konsolidierte GitHub-Workflows

- Status: Akzeptiert
- Datum: 2026-08-18
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: V1120-QA-010, V1110-QA-010, Q-ZUV-020, Q-ZUV-050

## Kontext

Die eigenständigen Workflows für Cloudflare-Wartung, Cloudflare-Performance und Mutation duplizierten
Prüfpfade, die bereits über CI oder ausdrücklich ausführbare npm-Kommandos verfügbar sind. Der
separate SonarQube-PR-Job erschien bei Pushes auf `main` stets als übersprungen, obwohl die
PR-Analyse nur für Pull-Request-Ereignisse relevant ist.

## Entscheidung

- Das Repository besitzt nur die Workflows `Continuous Integration` und `Cloudflare Deployment`;
  Dependabot bleibt ein von GitHub verwalteter Dienst.
- Mutationstests bleiben ein verpflichtender paralleler Job der vollständigen Branch-CI und damit
  Voraussetzung für das automatische Deployment. Ein zusätzlicher geplanter oder manueller
  Mutation-Workflow entfällt.
- Cloudflare-Wartung und die read-only Performance-SLO bleiben als explizit ausführbare
  npm-Kommandos erhalten, besitzen aber keine geplanten oder manuellen GitHub-Workflows mehr.
- Die SonarQube-PR-Analyse läuft als ereignisabhängiger Schritt im bestehenden Quality-Job. Der
  vollständige CI-Check wird für interne Pull-Request-Ereignisse weiterhin nicht doppelt ausgeführt.
- Workflow-Anzeigenamen verwenden englische Title-Case-Substantivphrasen.

## Folgen

- Die Actions-Übersicht zeigt nur dauerhafte Integrations- und Deployment-Abläufe; auf `main`
  erscheint kein separater übersprungener PR-Job mehr.
- Mutation bleibt vor jedem automatischen Deployment erzwungen und veröffentlicht weiterhin den
  vollständigen Bericht aus dem CI-Lauf.
- Compatibility-Alter, Remote-Health und harte Cloudflare-SLOs werden nur noch durch einen bewusst
  gestarteten lokalen beziehungsweise betrieblichen Prüflauf nachgewiesen; es gibt dafür keinen
  kalendergesteuerten GitHub-Nachweis.

## Verworfene Alternativen

- **SonarQube-PR-Analyse in einen dritten Workflow verschieben:** würde zwar übersprungene Jobs
  vermeiden, die bewusst verkleinerte Workflow-Liste aber wieder erweitern.
- **Mutation nur wöchentlich ausführen:** würde das fachliche Ratchet vom Deployment-Gate lösen.
- **Leere manuelle Hüllen für Wartung und Performance behalten:** erzeugt weiterhin sichtbare
  Workflows ohne zusätzlichen fachlichen Nachweis gegenüber den vorhandenen npm-Kommandos.
