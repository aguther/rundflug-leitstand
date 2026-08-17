# ADR-0057: Stabile CI und automatisches Cloudflare-Deployment

- Status: Akzeptiert
- Datum: 2026-08-17
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: V1120-QA-010, V1110-QA-010, Q-ZUV-020, Q-ZUV-050

## Kontext

GitHub Actions und der native Cloudflare-Git-Build führten bisher voneinander unabhängige Builds
desselben Commits aus. Tests mit absoluten Laufzeitgrenzen und mehrere konkurrierende Wrangler-
Prozesse je Runner reagierten empfindlich auf schwankende CPU-Leistung. Ein erneuter Lauf desselben
Commits konnte deshalb ohne Quelltextänderung grün werden. Das manuelle Deployment koppelte die
Anwendung von Migrationen außerdem an eine Bedienentscheidung, obwohl Ressourcenerzeugung und
Schemafortschreibung unterschiedliche Risiken besitzen.

## Entscheidung

- GitHub Actions ist die einzige automatische Build- und Deployment-Autorität. Native automatische
  Cloudflare-Git-Builds werden nach dem ersten erfolgreichen GitHub-Deployment deaktiviert.
- Jeder Push auf jeden Branch führt die vollständigen Qualitätsjobs einschließlich SonarQube-
  Branch-Analyse aus. Pull Requests aus demselben Repository erhalten zusätzlich eine native
  SonarQube-PR-Analyse; die übrigen Jobs werden für denselben Commit nicht doppelt ausgeführt.
- Runner-Image, Node-/npm-Version und alle externen GitHub Actions sind festgelegt. Ein gemeinsamer
  Composite-Step installiert die Toolchain mit begrenzten Download-Retries. Die SonarQube-Analyse
  verwendet den über `package-lock.json` gepinnten npm-Scanner direkt im Quality-/Coverage-Runner.
  Damit sind nach den Qualitätsprüfungen weder ein zusätzlicher Runner noch weitere Downloads von
  `checkout`, `setup-node`, `download-artifact` oder einer SonarSource-Action erforderlich.
- Fachliche Tests werden niemals automatisch wiederholt. Absolute Laufzeitassertions entfallen aus
  funktionalen Tests; Last- und Baselineprüfungen besitzen eigene Budgets. Die 18 lokalen V1-
  Integrationssuiten laufen in vier parallelen GitHub-Shards, innerhalb jedes Runners jedoch streng
  seriell und mit einem Diagnoseartefakt.
- Ein Push auf `main` deployt erst nach Basisprüfung, Coverage, Worker-Runtime, Forecast-Baseline,
  allen Integrationsshards, Restore-, Dokumentations-, Mutationstest und Sonar-Quality-Gate.
- Der Deployment-Preflight verifiziert Konto, Namen, unveränderliche D1-ID, EU-Jurisdiktion,
  R2-Bucket, vorhandenen Worker, Secrets und einen lokalen Wrangler-Dry-Run. Automatische
  Ressourcenanlage und Autokonfiguration bleiben deaktiviert.
- Migrationen sind separat in `deployment-safety.json` mit vollständiger SHA-256-Prüfsumme,
  Wiederherstellungsreferenz und Freigabe klassifiziert. Die Baseline `0001` ist nur für eine leere
  Erstinstallation zulässig. Automatisch angewendet werden ausschließlich ausstehende, unveränderte
  und ausdrücklich als `onlineSafe` freigegebene Folgemigrationen.
- Vor offenen Online-Migrationen ermittelt die Pipeline einen D1-Time-Travel-Bookmark und fordert
  über einen geschützten, idempotenten Worker-Endpunkt ein portables R2-Backup mit SHA-256-Sidecar
  an. Cloudflare speichert nur den Hash des GitHub-Environment-Secrets
  `DEPLOYMENT_BACKUP_TOKEN`; Token, Request-Body und Bookmark werden nicht protokolliert.
- Beim normalen Rollout lädt `wrangler deploy --secrets-file` Code, `SOURCE_REVISION` und den Hash des
  Deployment-Backup-Tokens gemeinsam als eine Version hoch. `wrangler secret put` bleibt einer
  ausdrücklichen Tokenrotation vorbehalten und erzeugt nicht mehr bei jedem Commit eine vorgezogene
  Zwischenversion.
- Erst danach folgen die Prüfung von Health, Migrationen und Secrets sowie eine zeitlich begrenzte
  Beobachtung von `/api/meta`. Die erwartete Revision muss mit deaktiviertem Cache und wechselnder
  Prüf-URL zweimal hintereinander erscheinen. Wiederholungen von mutierenden Cloudflare-Kommandos
  bleiben auf drei Versuche begrenzt und ausschließlich für klar transiente Infrastrukturfehler wie
  HTTP 429/5xx, Timeouts oder Verbindungsabbrüche zulässig.

## Folgen

- Branches liefern vor einem Pull Request denselben belastbaren Qualitätsnachweis wie `main`.
- Ein grüner Wiederholungslauf kann keine fehlerhaften Tests kaschieren, weil Testfehler nicht
  wiederholt werden. Shards reduzieren Laufzeit, ohne mehrere workerd-Prozesse auf einem Runner um
  dieselben Ressourcen konkurrieren zu lassen.
- „Keine automatische Ressourcenanlage“ und „automatische Migration“ widersprechen sich nicht:
  Der Preflight verlangt vorhandene, exakt identifizierte Ressourcen; nur deren geprüfte
  Schemafortschreibung ist automatisiert.
- Ein fehlendes Secret, eine abweichende Ressourcen-ID, eine ungeprüfte Migration, ein fehlendes
  Backup oder eine falsche Deployment-Revision stoppt den Rollout vor dem nächsten Schritt.
- Eine noch nicht überall sichtbare neue Worker-Version macht den Rollout nicht vorschnell rot; eine
  dauerhaft alte oder wechselnde Revision überschreitet dagegen das feste Beobachtungsfenster und
  bleibt ein Fehler.
- Die manuelle Workflow-Auslösung bleibt als kontrollierter Wiederanlauf verfügbar, verwendet aber
  exakt denselben Preflight-, Backup-, Migrations- und Verifikationspfad.

## Verworfene Alternativen

- **GitHub und Cloudflare parallel automatisch bauen lassen:** erzeugt zwei nicht serialisierte
  Deployment-Autoritäten und erschwert die Zuordnung einer Revision.
- **Alle Fehlschläge pauschal wiederholen:** macht deterministische Test-, Typ-, Lint- und
  Migrationsfehler scheinbar flüchtig.
- **Wrangler Ressourcen bei Bedarf automatisch anlegen lassen:** könnte Tippfehler oder eine
  veraltete ID als neue leere Ressource materialisieren.
- **Migrationen grundsätzlich manuell halten:** verhindert zwar unerwartete Schemaänderungen,
  lässt aber einen sicheren, bereits geprüften Teil des Releases von einer Bedienentscheidung
  abhängen und öffnet ein Driftfenster zwischen Worker und D1.
