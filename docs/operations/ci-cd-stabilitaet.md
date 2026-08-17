# Stabiler Build- und Deployment-Ablauf

## Ablauf für Arbeitsbranches und Pull Requests

1. Jeder Push auf einen beliebigen Branch startet die vollständigen GitHub-Prüfungen.
2. Basisprüfung und Coverage, Worker-Runtime, Forecast-Baseline, vier V1-Integrationsshards,
   Backup-Restore, Dokumentation und Mutationstests laufen als getrennte Jobs.
3. Die vier V1-Shards laufen parallel. Innerhalb eines Shards läuft immer nur eine Suite und damit
   höchstens ein lokaler Wrangler-/workerd-Prozess gleichzeitig.
4. Nach erfolgreicher Coverage analysiert SonarQube Cloud den Branch und wartet auf das Quality Gate.
5. Ein Pull Request aus demselben Repository erhält zusätzlich eine PR-Analyse. Die bereits für den
   Branch-Commit ausgeführten übrigen Jobs werden im PR-Ereignis übersprungen.
6. Test-, Lint-, Typ-, Coverage-, Migrations- und Sonarfehler werden nicht automatisch wiederholt.
   Nur erkannte Infrastrukturfehler in Cloudflare-Kommandos dürfen höchstens dreimal versucht werden.

## Ablauf für `main`

1. Der Push auf `main` durchläuft dieselben Prüfungen wie jeder andere Branch.
2. Ist die Repository-Variable `CLOUDFLARE_AUTOMATIC_DEPLOYMENT_ENABLED` auf `true` gesetzt, ruft CI
   erst nach allen grünen Gates den wiederverwendbaren Cloudflare-Workflow auf. Vor der einmaligen
   Inbetriebnahme bleibt der Job bewusst übersprungen.
3. Der Workflow erzeugt aus den geschützten Environment-Werten eine commitgebundene Wrangler-
   Konfiguration und baut Web und Worker ohne erneuten Testlauf.
4. Der Preflight prüft ausschließlich vorhandene Ressourcen: Account, Worker, D1-Name und -ID,
   EU-Jurisdiktion, R2-Bucket, Bindings und Secrets. Wrangler-Autokonfiguration und automatische
   Ressourcenanlage sind ausgeschaltet.
5. Gibt es keine Migration, wird direkt deployt.
6. Gibt es Migrationen, müssen Dateiprüfsumme und `onlineSafe`-Freigabe stimmen. Dann werden zuerst
   D1-Time-Travel-Bookmark und portables R2-Backup samt SHA-256-Sidecar erzeugt, anschließend alle
   freigegebenen Migrationen angewendet.
7. Wrangler deployt exakt den geprüften Commit. Der Abschlusscheck verlangt dieselbe Revision in
   `/api/meta`, aktuelle Migrationen, vollständige Secrets und erfolgreiche Healthchecks.

Damit bleibt die Ressourcenanlage eine bewusste Bootstrap-/Neuaufbauhandlung. Die automatische
Migration verändert nur das Schema der zuvor eindeutig verifizierten D1.

## Einmalige Inbetriebnahme

- Im geschützten GitHub-Environment `rundflug-leitstand` muss ein zufälliges Secret
  `DEPLOYMENT_BACKUP_TOKEN` mit mindestens 32 Zeichen hinterlegt sein. Cloudflare erhält über den
  Workflow ausschließlich dessen SHA-256-Hash als `DEPLOYMENT_BACKUP_TOKEN_HASH`.
- `CLOUDFLARE_DEPLOYMENT_URL` muss auf den bereits vorhandenen Worker zeigen.
- Zuerst wird der manuelle Workflow `Cloudflare deployment` mit Bestätigung `DEPLOY` vollständig
  einschließlich Revisionsprüfung ausgeführt.
- Danach wird die Repository-Variable `CLOUDFLARE_AUTOMATIC_DEPLOYMENT_ENABLED` auf `true` gesetzt und
  ein automatischer `main`-Lauf erfolgreich geprüft.
- Erst danach werden native automatische Git-Builds im Cloudflare-Dashboard deaktiviert. So besteht zu
  keinem Zeitpunkt eine Lücke ohne funktionierenden Deployment-Pfad. Bei einer Rücknahme wird zuerst
  der native Pfad wieder aktiviert und danach die Repository-Variable entfernt oder auf `false` gesetzt.
- Bei einem manuellen Wiederanlauf wird `Cloudflare deployment` mit demselben Environment und der
  Bestätigung `DEPLOY` gestartet; es gelten dieselben Sicherheitsprüfungen.
