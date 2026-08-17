# Cloudflare-Neuaufbau – Release 1.12.0

Diese Anleitung baut eine **leere, eigenständig deploybare Umgebung** aus einem frischen Checkout
auf. Sie importiert keine Sicherung und schaltet keine bestehende Domain um. Das Bootstrap löscht
oder leert niemals vorhandene Ressourcen.

## 1. Voraussetzungen

- Cloudflare-Account mit zwei verantwortlichen Personen, erzwungener 2FA und Rechten für Workers,
  D1, R2, Durable Objects, Rate Limits und Secrets,
- Node.js 24.18.0 als Standard- und Deployment-Version, npm 12.0.2 und ein frischer Checkout des
  freigegebenen Commits; Node.js 22.22.2 bleibt ausschließlich die in CI geprüfte minimale
  unterstützte Version,
- `npm install` und ein erfolgreicher Lauf von `npm run check`,
- interaktive Wrangler-Anmeldung mit `npx wrangler login`,
- Passwortsafe für den einmalig angezeigten Installations-Notfallcode und ein darin erzeugtes,
  mindestens 32 Zeichen langes `DEPLOYMENT_BACKUP_TOKEN`,
- erreichbare HTTPS- oder `mailto:`-Adresse als VAPID-Kontakt.

Bei mehreren zugänglichen Cloudflare-Accounts ist zusätzlich `--account-id <ID>` anzugeben. Die ID
wird nur im ignorierten lokalen Zielmanifest und in der generierten Wrangler-Konfiguration
gespeichert.

## 2. Namensblatt

Vor dem Start ausfüllen:

| Wert | Beispiel | Festlegung |
| --- | --- | --- |
| Zielname | `verein-abnahme` |  |
| Worker | `rundflug-leitstand-abnahme` |  |
| D1 | `rundflug-leitstand-abnahme-db` |  |
| R2 | `rundflug-leitstand-abnahme-backups` |  |
| Umgebung | `acceptance` oder `production` |  |
| spätere Domain | `leitstand.example.de` |  |
| VAPID-Kontakt | `https://example.de/` |  |
| Cloudflare-Account-ID, falls mehrere | UUID aus Cloudflare |  |

Nur der Zielname ist zwingend. Ohne Überschreibung werden Worker, D1 und R2 daraus abgeleitet.

## 3. Vorschau ohne Änderungen

```bash
npm run cloudflare:bootstrap -- \
  --target verein-abnahme \
  --worker-name rundflug-leitstand-abnahme \
  --d1-name rundflug-leitstand-abnahme-db \
  --r2-name rundflug-leitstand-abnahme-backups \
  --app-env acceptance \
  --vapid-subject https://example.de/ \
  --dry-run
```

Die Ausgabe nennt Ziel, Ressourcennamen, EU-Jurisdiktion, lokale Konfigurationsdatei und geplante
Aktionen. `--dry-run` meldet sich nicht bei Cloudflare an und verändert nichts.

## 4. Aufbau und sichere Wiederaufnahme

Nach Prüfung `DEPLOYMENT_BACKUP_TOKEN` über einen sicheren, nicht protokollierten Prozesskontext
bereitstellen und denselben Befehl ohne `--dry-run` ausführen. Das Skript:

1. bestimmt den angemeldeten Cloudflare-Account eindeutig,
2. erkennt D1 und R2 oder legt sie mit Jurisdiktion `eu` an,
3. erzeugt `wrangler.<ziel>.generated.jsonc` mit Static Assets, D1, R2, Durable Object, Rate Limits,
   Cron und Observability,
4. schreibt den Fortsetzungsstand nach `.wrangler/targets/<ziel>.json`,
5. erzeugt Installations-Notfallcode, Reset-Signierschlüssel und VAPID-Schlüsselpaar ausschließlich
   im Arbeitsspeicher, bildet den SHA-256-Hash des bereitgestellten Deployment-Tokens und überträgt
   nur diese Werte als Worker-Secrets,
6. wendet alle Migrationen auf die leere D1 an, baut die PWA und deployt Worker und Assets,
7. zeigt den Installations-Notfallcode genau einmal sowie Worker-, Setup- und Prüfbefehl an.

Beide lokalen Dateien sind von Git ausgeschlossen. D1-IDs müssen nicht manuell eingetragen werden.
Demo-Seeds werden nicht ausgeführt. Jede erzeugte Zielkonfiguration deklariert unter
`secrets.required` ausschließlich die sechs aktuellen Secret-Namen. Die eingecheckte
`wrangler.jsonc` führt die Namen des bestehenden Kompatibilitätsprofils. Dadurch bleiben
Typgenerierung und CI unabhängig von lokalen `.dev.vars`; Secret-Werte stehen weiterhin nie in
der Konfiguration oder im Repository.

Nach einem Abbruch exakt dieselben Namen und zusätzlich `--resume` verwenden:

```bash
npm run cloudflare:bootstrap -- \
  --target verein-abnahme \
  --app-env acceptance \
  --vapid-subject https://example.de/ \
  --resume
```

Vorhandene Ressourcen werden nur im ausgewählten Account und mit passendem Namen/Typ verwendet.
Eine nachweislich andere Jurisdiktion oder ein abweichendes Zielmanifest führt zum Abbruch.
`--rotate-secrets` ist kein normaler Resume-Schritt: Es ersetzt Notfall-, Signier-, Deployment- und
VAPID-Schlüssel; bestehende Push-Abonnements müssen danach neu aktiviert werden. Derselbe neue
Klartextwert des Deployment-Tokens muss anschließend als GitHub-Environment-Secret hinterlegt sein.

Produktion benötigt immer beide Angaben:

```text
--app-env production --confirm-production
```

## 5. Browserbasierte Ersteinrichtung

1. Den einmal angezeigten Installations-Notfallcode sofort im Passwortsafe speichern.
2. Die ausgegebene `/setup`-Adresse im vorgesehenen Administrationsbrowser öffnen.
3. Notfallcode, Veranstaltungsdaten und eine neue 6- bis 12-stellige Administrator-PIN eingeben.
4. Nach Erfolg abmelden und mit dem neu angelegten Administratorkonto wieder anmelden.

Nach einem späteren Werksreset wird im selben authentifizierten Browser kein Code benötigt. Der
Worker stellt nach Prüfung von Sitzung, Adminrolle, Gerätebindung und aktueller Konto-PIN ein
hostgebundenes, 30 Minuten gültiges, einmal verwendbares `Secure`-/`HttpOnly`-/`SameSite=Strict`-
Cookie aus. Nur wenn Browser und Grant verloren sind, wird der Notfallcode benötigt. Er funktioniert
ausschließlich bei nachweislich leerer Installation. Ist auch er verloren, muss
`INSTALLATION_RECOVERY_CODE` bewusst im Cloudflare-Account rotiert werden.

## 6. Vollständige Prüfung

```bash
npm run cloudflare:verify -- --target verein-abnahme
```

Falls Wrangler die Deployment-URL nicht ermitteln konnte:

```bash
npm run cloudflare:verify -- \
  --target verein-abnahme \
  --url https://rundflug-leitstand-abnahme.example.workers.dev
```

Die Prüfung verlangt: keine offene Migration, alle sechs Secret-Namen, Health- und Metadaten in
Version 1.12.0, EU-Datenjurisdiktion, eindeutige Deployment-Revision, Setup-Status und einen
öffentlichen VAPID-Schlüssel. Danach
werden in einem privaten Browserfenster je ein Rollen-Smoke-Test für Kasse, Flight Line, Flight
Director, FIDS und Administration sowie ein öffentlicher Gruppenstatus geprüft.

## 7. Versionierter GitHub-Deployment-Workflow

`.github/workflows/deploy-cloudflare.yml` wird nach allen grünen Gates eines Pushes auf `main`
automatisch aufgerufen, sobald die Repository-Variable
`CLOUDFLARE_AUTOMATIC_DEPLOYMENT_ENABLED=true` gesetzt ist, und bleibt zusätzlich mit Bestätigung
`DEPLOY` manuell wiederanlaufbar. Beide Pfade verwenden eine geschützte GitHub-Environment mit
demselben Zielnamen. Dort konfigurieren:

| GitHub-Wert | Art |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Secret, minimaler Deployment-/D1-Zugriff |
| `CLOUDFLARE_ACCOUNT_ID` | Secret |
| `CLOUDFLARE_D1_DATABASE_ID` | Secret |
| `DEPLOYMENT_BACKUP_TOKEN` | Secret mit mindestens 32 zufälligen Zeichen; Klartext nur in GitHub |
| `CLOUDFLARE_WORKER_NAME` | Variable |
| `CLOUDFLARE_D1_NAME` | Variable |
| `CLOUDFLARE_R2_NAME` | Variable |
| `CLOUDFLARE_APP_ENV` | Variable `acceptance` oder `production` |
| `CLOUDFLARE_DEPLOYMENT_URL` | Variable mit dem HTTPS-Origin des vorhandenen Workers |

Für Produktion sind Environment-Reviewer verpflichtend. Die vorgeschaltete CI führt alle Prüfungen
einschließlich Mutation und Sonar aus. Der Deployment-Workflow rekonstruiert die ignorierte,
commitgebundene Zielkonfiguration und prüft vorhandenen Worker, D1-ID, EU-R2 und Bindings, ohne
Ressourcen anzulegen. Er überträgt ausschließlich den SHA-256-Hash des
`DEPLOYMENT_BACKUP_TOKEN` als Worker-Secret.

Offene Migrationen werden nur angewendet, wenn Dateiprüfsumme und `onlineSafe`-Freigabe in
`apps/worker/migrations/deployment-safety.json` stimmen. Vorher werden D1-Time-Travel-Bookmark und
portables `PRE_DEPLOY`-Backup erzeugt. `0001_v1_12_baseline.sql` bleibt dem leeren Neuaufbau
vorbehalten. Nach dem Deployment muss `/api/meta` exakt den GitHub-Commit melden. Anwendungssecrets
bleiben direkt am Worker und werden nicht nach GitHub kopiert. Der vollständige Ablauf steht in
[`ci-cd-stabilitaet.md`](ci-cd-stabilitaet.md) und ADR-0057.

Die harte Performance-SLO ist bewusst kein Bestandteil dieses allgemeinen GitHub-Checks. Für eine
isolierte Abnahmeumgebung steht der manuelle Workflow `Cloudflare-Performance-SLO` bereit. Er erhält
Environment, HTTPS-Origin und die ID einer vorbereiteten synthetischen `perf-*`-Veranstaltung als
Eingaben und startet erst nach der Bestätigung `PERFORMANCE`. Der Lauf führt ausschließlich lesende
öffentliche Board-Abfragen und WebSocket-Verbindungen aus; Produktionsumgebungen, andere
Veranstaltungs-IDs sowie HTTP-Ziele werden vom Skript abgelehnt. Details und Datensatzanforderungen
sind in `docs/verification/scale-performance-v1.md` dokumentiert.

## 8. Monatliche Runtime-Wartung

Der geplante Workflow `Cloudflare-Maintenance` prüft am ersten Tag jedes Monats zusätzlich zum
manuellen Start:

- ein Höchstalter von 45 Tagen für die Compatibility-Date,
- den gemeinsamen Stand von Wrangler, workerd, Worker-Typen und Worker-Testpool,
- unveränderte generierte Bindings und Worker-Runtime-Tests,
- persistierte, gesampelte Observability,
- `/api/health`, `/api/meta`, die Deployment-Revision, Migrationen und Secrets,
- sowie durch Verhaltenstests, dass freie Fehlerdetails mit PINs, Tokens, Telefonnummern,
  Push-Endpunkten und öffentlichen Ticketcodes nicht in Worker-Logs gelangen.

Der normale Build prüft dieselbe Konfiguration, wird aber nicht allein durch das Kalenderalter der
Compatibility-Date instabil. Für das GitHub-Environment `rundflug-leitstand` wird zusätzlich die
Variable `CLOUDFLARE_DEPLOYMENT_URL` gepflegt.

## 9. Einmaliger D1-Baseline-Neuaufbau

Der folgende Ablauf ist ausschließlich für das ausdrücklich zum Datenverlust freigegebene Ziel und
erst nach Factory Reset, leerem R2 und erfolgreichem `npm run check` zulässig. Ohne `--confirm` führt
das CLI nur Konto-, Manifest-, Ressourcen- und Jurisdiktionsprüfungen aus:

```bash
npm run cloudflare:recreate-d1 -- --target rundflug-leitstand
```

Die Ausgabe nennt den exakt erforderlichen Bestätigungstext. Erst der zweite Lauf darf löschen:

```bash
npm run cloudflare:recreate-d1 -- \
  --target rundflug-leitstand \
  --confirm DELETE-rundflug-leitstand-db
```

Der erwartete Text wird immer aus dem D1-Namen im ignorierten Zielmanifest abgeleitet; das Beispiel
ist daher nicht zu kopieren, wenn die Vorschau einen anderen Namen meldet. Das CLI löscht nur die
bestätigte Remote-D1, legt sie unter demselben Namen mit `jurisdiction eu` neu an, aktualisiert lokale
Zieldateien und wendet alle ausstehenden, eingecheckten D1-Migrationen an. Beim ursprünglichen
V1.12-Neuaufbau war dies ausschließlich `0001_v1_12_baseline.sql`; spätere Neuaufbauten wenden
zusätzlich die lückenlosen Folgemigrationen ab `0002` an. R2, Worker, URL und Secrets
werden weder gelöscht noch verändert. Es erfolgt kein Deployment und kein Remote-Demo-Seed.

Schlägt der Lauf nach der Löschung fehl, wird nicht zur alten D1-ID zurückgewechselt. Nach einer vom
CLI selbst bestätigten Neuanlage markiert das Zielmanifest den Neuaufbau als ausstehend; derselbe
Befehl mit derselben exakten Bestätigung setzt dann ausschließlich diesen belegten Zwischenstand fort,
ohne D1 erneut zu löschen. Neue Ressource und Zielmanifest werden geprüft, alle ausstehenden
Migrationen werden erneut angewandt und erst danach separat deployt.
Ein fachlich erforderlicher Daten-Restore erfolgt ausschließlich in einer isolierten Datenbank nach
`backup-restore.md`.

## 10. Fehlerbehebung ohne Datenverlust

- Außerhalb des ausdrücklich freigegebenen Baseline-Neuaufbaus niemals D1/R2 löschen, leeren oder
  unter demselben Namen neu erstellen.
- Bei Namens- oder Accountabweichung abbrechen, Namensblatt und
  `.wrangler/targets/<ziel>.json` vergleichen.
- Bei einer Teilmenge vorhandener Secrets erst Ziel und Account prüfen. Danach entweder fehlende
  Werte kontrolliert ergänzen oder den vollständigen Satz mit `--rotate-secrets` rotieren.
- Bei offener Migration verlangt der automatische Pfad vor jeder Änderung einen belegten
  Backup-/D1-Time-Travel-Punkt; ohne `onlineSafe`-Freigabe bricht er ab.
- Bei verlorenem Zielmanifest vorhandene Ressourcen zunächst nur mit Wrangler lesen; anschließend
  Bootstrap mit den exakten Namen und `--resume` starten.
- Domain-Cutover und Backup-Import sind getrennte, freigabepflichtige Verfahren.

Technische Referenzen: [Wrangler-Umgebungen](https://developers.cloudflare.com/workers/wrangler/environments/),
[D1-Kommandos](https://developers.cloudflare.com/d1/wrangler-commands/),
[R2-Kommandos](https://developers.cloudflare.com/r2/reference/wrangler-commands/),
[Worker-Secrets](https://developers.cloudflare.com/workers/configuration/secrets/) und
[GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).
