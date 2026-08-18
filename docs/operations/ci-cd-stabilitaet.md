# Stabiler Build- und Deployment-Ablauf

## Ablauf für Arbeitsbranches und Pull Requests

1. Jeder Push auf einen beliebigen Branch startet die vollständigen GitHub-Prüfungen.
2. Basisprüfung und Coverage, Worker-Runtime, Forecast-Baseline, vier V1-Integrationsshards,
   Backup-Restore, Dokumentation und Mutationstests laufen als getrennte Jobs.
3. Die vier V1-Shards laufen parallel. Innerhalb eines Shards läuft immer nur eine Suite und damit
   höchstens ein lokaler Wrangler-/workerd-Prozess gleichzeitig.
4. Nach erfolgreicher Coverage analysiert SonarQube Cloud im selben Quality-Runner den Branch und
   wartet auf das Quality Gate. Der Scanner stammt aus der mit `package-lock.json` installierten
   Projektabhängigkeit. Dadurch entfallen ein zusätzlicher Runner sowie weitere Downloads von
   `checkout`, `setup-node`, `download-artifact` und einer SonarSource-Action.
5. Ein Pull Request aus demselben Repository erhält im selben Quality-Job zusätzlich eine
   PR-Analyse. Der vollständige CI-Check und die übrigen Jobs werden im PR-Ereignis nicht doppelt
   ausgeführt; auf `main` existiert kein separater übersprungener PR-Job.
6. Test-, Lint-, Typ-, Coverage-, Migrations- und Sonarfehler werden nicht automatisch wiederholt.
   Nur erkannte Infrastrukturfehler in Cloudflare-Kommandos dürfen höchstens dreimal versucht werden.

Das aggregierte PWA-Precache-Budget behält seine verpflichtende Zehn-Prozent-Reserve, besitzt aber
innerhalb dieser Reserve einen kleinen Abstand zur gemessenen Buildstreuung. Unterschiedliche zulässige
Chunkanordnungen dürfen einen unveränderten Web-Quellstand deshalb nicht abwechselnd grün und rot machen.

Funktionale Realtime-Integrationen warten auf die erwartete Ereignisversion innerhalb eines festen
Sicherheitsfensters und wiederholen keine Kommandos. Absolute Latenzbudgets gehören ausschließlich in
die getrennten Baseline- und Skalierungsläufe; schwankende Runner-Zeit darf einen fachlich korrekten
Vertical-Slice nicht rot machen.

Auch die Lastprüfungen trennen Wandzeit und CPU-Budget: Die Planning-History-Skala erzwingt die
absolute Zwei-Sekunden-Grenze weiterhin über monotone Wandzeit, bewertet die relative
Zehn-Prozent-CPU-Verschlechterung jedoch über die Prozess-CPU-Zeit einer gleich großen indexierten
Snapshot-Lookup-Stichprobe. Dadurch bleibt das fachliche Budget für den von der Kompaktion
beeinflussbaren Anteil unverändert, während Betriebssystem-Scheduling und der identische synthetische
Forecast-Rechenkern nicht als Datenbankregression fehlklassifiziert werden.

## Ablauf für `main`

1. Der Push auf `main` durchläuft dieselben Prüfungen wie jeder andere Branch.
2. Ist die Repository-Variable `CLOUDFLARE_AUTOMATIC_DEPLOYMENT_ENABLED` auf `true` gesetzt, ruft CI
   erst nach allen grünen Gates den wiederverwendbaren Cloudflare-Workflow auf. Vor der einmaligen
   Inbetriebnahme bleibt der Job bewusst übersprungen.
3. Der Workflow erzeugt aus den geschützten Environment-Werten eine commitgebundene Wrangler-
   Konfiguration und baut Web und Worker ohne erneuten Testlauf.
4. Der Preflight prüft ausschließlich vorhandene Ressourcen: Account, Worker, D1-Name und -ID,
   EU-Jurisdiktion, R2-Bucket, Bindings und die bereits vorhandenen langlebigen Secrets. Wrangler-
   Autokonfiguration und automatische Ressourcenanlage sind ausgeschaltet.
5. Gibt es keine Migration, wird direkt deployt.
6. Gibt es Migrationen, müssen Dateiprüfsumme und `onlineSafe`-Freigabe stimmen. Dann werden zuerst
   D1-Time-Travel-Bookmark und portables R2-Backup samt SHA-256-Sidecar erzeugt, anschließend alle
   freigegebenen Migrationen angewendet.
7. Wrangler deployt exakt den geprüften Commit und den SHA-256-Hash des Backup-Tokens gemeinsam über
   `--secrets-file` als eine Worker-Version. Die übrigen Cloudflare-Secrets bleiben erhalten. Der
   normale Commit-Deploy erzeugt deshalb keine vorgezogene Zwischenversion mehr.
8. Der Abschlusscheck verlangt dieselbe Revision in `/api/meta`, aktuelle Migrationen, vollständige
   Secrets und erfolgreiche Healthchecks. Wegen der verteilten Worker-Aktivierung wird die Revision
   höchstens etwa 90 Sekunden beobachtet und muss zweimal hintereinander mit deaktiviertem Cache und
   wechselnder Prüf-URL übereinstimmen. Eine dauerhaft falsche Revision bleibt ein harter Fehler.

Damit bleibt die Ressourcenanlage eine bewusste Bootstrap-/Neuaufbauhandlung. Die automatische
Migration verändert nur das Schema der zuvor eindeutig verifizierten D1.

## Einmalige Inbetriebnahme

- Im geschützten GitHub-Environment `rundflug-leitstand` muss ein zufälliges Secret
  `DEPLOYMENT_BACKUP_TOKEN` mit mindestens 32 Zeichen hinterlegt sein. Cloudflare erhält über den
  eigentlichen Worker-Upload ausschließlich dessen SHA-256-Hash als
  `DEPLOYMENT_BACKUP_TOKEN_HASH`. Der Klartext wird nicht in eine Datei geschrieben.
- Der neue Hash wird bewusst vom abschließenden GitHub-Check und nicht von Wranglers allgemeiner
  `secrets.required`-Liste erzwungen. Dadurch bleibt der bisherige native Cloudflare-Pfad während der
  Inbetriebnahme deployfähig, obwohl der Backup-Endpunkt dort bis zum ersten GitHub-Deployment noch
  nicht autorisierbar ist.
- `CLOUDFLARE_DEPLOYMENT_URL` muss auf den bereits vorhandenen Worker zeigen.
- Zuerst wird der manuelle Workflow `Cloudflare Deployment` mit Bestätigung `DEPLOY` vollständig
  einschließlich Revisionsprüfung ausgeführt.
- Danach wird die Repository-Variable `CLOUDFLARE_AUTOMATIC_DEPLOYMENT_ENABLED` auf `true` gesetzt und
  ein automatischer `main`-Lauf erfolgreich geprüft.
- Erst danach werden native automatische Git-Builds im Cloudflare-Dashboard deaktiviert. So besteht zu
  keinem Zeitpunkt eine Lücke ohne funktionierenden Deployment-Pfad. Bei einer Rücknahme wird zuerst
  der native Pfad wieder aktiviert und danach die Repository-Variable entfernt oder auf `false` gesetzt.
- Bei einem manuellen Wiederanlauf wird `Cloudflare Deployment` mit demselben Environment und der
  Bestätigung `DEPLOY` gestartet; es gelten dieselben Sicherheitsprüfungen.

## Rotation des Deployment-Backup-Tokens

`DEPLOYMENT_BACKUP_TOKEN` ist langlebig und wird nicht bei jedem Commit rotiert. Bei einer bewussten
Rotation werden automatisches Deployment und Migrationen zunächst angehalten. Der neue Klartext wird
im geschützten GitHub-Environment hinterlegt und sein Hash mit demselben Wert einmalig über
`npm run cloudflare:deployment-credential -- --target <ziel>` an den bestehenden Worker übertragen.
Dieser ausdrückliche Rotationsschritt darf eine eigene Worker-Version erzeugen. Anschließend wird der
manuelle Deployment-Workflow vollständig ausgeführt und erst nach grüner Revisionsprüfung wieder auf
automatische Deployments umgestellt. Bei einer Abweichung zwischen GitHub-Token und Cloudflare-Hash
scheitert ein erforderliches Pre-Deployment-Backup vor jeder Migration.
