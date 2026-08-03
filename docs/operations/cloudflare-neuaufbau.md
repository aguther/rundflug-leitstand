# Cloudflare-Neuaufbau – Release 1.11.0

Diese Anleitung baut eine **leere, eigenständig deploybare Umgebung** aus einem frischen Checkout
auf. Sie importiert keine Sicherung und schaltet keine bestehende Domain um. Das Bootstrap löscht
oder leert niemals vorhandene Ressourcen.

## 1. Voraussetzungen

- Cloudflare-Account mit zwei verantwortlichen Personen, erzwungener 2FA und Rechten für Workers,
  D1, R2, Durable Objects, Rate Limits und Secrets,
- Node.js 22.22.2 beziehungsweise ab 24.15 innerhalb einer unterstützten geraden Hauptversion,
  npm 12.0.2 und ein frischer Checkout des freigegebenen Commits,
- `npm install` und ein erfolgreicher Lauf von `npm run check`,
- interaktive Wrangler-Anmeldung mit `npx wrangler login`,
- Passwortsafe für den einmalig angezeigten Installations-Notfallcode,
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

Nach Prüfung denselben Befehl ohne `--dry-run` ausführen. Das Skript:

1. bestimmt den angemeldeten Cloudflare-Account eindeutig,
2. erkennt D1 und R2 oder legt sie mit Jurisdiktion `eu` an,
3. erzeugt `wrangler.<ziel>.generated.jsonc` mit Static Assets, D1, R2, Durable Object, Rate Limits,
   Cron und Observability,
4. schreibt den Fortsetzungsstand nach `.wrangler/targets/<ziel>.json`,
5. erzeugt Installations-Notfallcode, Reset-Signierschlüssel und VAPID-Schlüsselpaar ausschließlich
   im Arbeitsspeicher und überträgt sie als Worker-Secrets,
6. wendet alle Migrationen auf die leere D1 an, baut die PWA und deployt Worker und Assets,
7. zeigt den Installations-Notfallcode genau einmal sowie Worker-, Setup- und Prüfbefehl an.

Beide lokalen Dateien sind von Git ausgeschlossen. D1-IDs müssen nicht manuell eingetragen werden.
Demo-Seeds werden nicht ausgeführt. Jede erzeugte Zielkonfiguration deklariert unter
`secrets.required` ausschließlich die fünf aktuellen Secret-Namen. Die eingecheckte
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
`--rotate-secrets` ist kein normaler Resume-Schritt: Es ersetzt Notfall-, Signier- und
VAPID-Schlüssel; bestehende Push-Abonnements müssen danach neu aktiviert werden.

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

Die Prüfung verlangt: keine offene Migration, alle fünf Secret-Namen, Health- und Metadaten in
Version 1.11.0, EU-Datenjurisdiktion, Setup-Status und einen öffentlichen VAPID-Schlüssel. Danach
werden in einem privaten Browserfenster je ein Rollen-Smoke-Test für Kasse, Flight Line, Flight
Director, FIDS und Administration sowie ein öffentlicher Gruppenstatus geprüft.

## 7. Versionierter GitHub-Deployment-Workflow

`.github/workflows/deploy-cloudflare.yml` deployt ausschließlich manuell und verwendet eine
geschützte GitHub-Environment mit demselben Zielnamen. Dort konfigurieren:

| GitHub-Wert | Art |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Secret, minimaler Deployment-/D1-Zugriff |
| `CLOUDFLARE_ACCOUNT_ID` | Secret |
| `CLOUDFLARE_D1_DATABASE_ID` | Secret |
| `CLOUDFLARE_WORKER_NAME` | Variable |
| `CLOUDFLARE_D1_NAME` | Variable |
| `CLOUDFLARE_R2_NAME` | Variable |
| `CLOUDFLARE_APP_ENV` | Variable `acceptance` oder `production` |

Für Produktion sind Environment-Reviewer verpflichtend. Der Workflow verlangt zusätzlich die
Bestätigung `DEPLOY`, führt `npm run check` aus, rekonstruiert die ignorierte Zielkonfiguration und
bricht bei offenen Migrationen ab, solange `apply_migrations` nicht bewusst gewählt wurde.
Anwendungssecrets bleiben direkt am Worker und werden nicht nach GitHub kopiert.

Die harte Performance-SLO ist bewusst kein Bestandteil dieses allgemeinen GitHub-Checks. Für eine
isolierte Abnahmeumgebung steht der manuelle Workflow `Cloudflare-Performance-SLO` bereit. Er erhält
Environment, HTTPS-Origin und die ID einer vorbereiteten synthetischen `perf-*`-Veranstaltung als
Eingaben und startet erst nach der Bestätigung `PERFORMANCE`. Der Lauf führt ausschließlich lesende
öffentliche Board-Abfragen und WebSocket-Verbindungen aus; Produktionsumgebungen, andere
Veranstaltungs-IDs sowie HTTP-Ziele werden vom Skript abgelehnt. Details und Datensatzanforderungen
sind in `docs/verification/scale-performance-v1.md` dokumentiert.

## 8. Fehlerbehebung ohne Datenverlust

- Niemals D1/R2 löschen, leeren oder unter demselben Namen neu erstellen.
- Bei Namens- oder Accountabweichung abbrechen, Namensblatt und
  `.wrangler/targets/<ziel>.json` vergleichen.
- Bei einer Teilmenge vorhandener Secrets erst Ziel und Account prüfen. Danach entweder fehlende
  Werte kontrolliert ergänzen oder alle fünf mit `--rotate-secrets` rotieren.
- Bei offener Migration vor jeder Änderung Backup-/D1-Time-Travel-Punkt prüfen.
- Bei verlorenem Zielmanifest vorhandene Ressourcen zunächst nur mit Wrangler lesen; anschließend
  Bootstrap mit den exakten Namen und `--resume` starten.
- Domain-Cutover und Backup-Import sind getrennte, freigabepflichtige Verfahren.

Technische Referenzen: [Wrangler-Umgebungen](https://developers.cloudflare.com/workers/wrangler/environments/),
[D1-Kommandos](https://developers.cloudflare.com/d1/wrangler-commands/),
[R2-Kommandos](https://developers.cloudflare.com/r2/reference/wrangler-commands/),
[Worker-Secrets](https://developers.cloudflare.com/workers/configuration/secrets/) und
[GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).
