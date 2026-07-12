# Cloudflare-Einrichtung

## 1. Konto und Zugriff

1. Vereins-/Projektaccount anlegen.
2. Zwei verantwortliche Personen einladen.
3. Zwei-Faktor-Authentifizierung erzwingen.
4. Für CI einen minimal berechtigten Account-API-Token anlegen.

## 2. Anmeldung

```bash
npx wrangler login
```

## 3. D1 in EU-Jurisdiktion anlegen

```bash
npx wrangler d1 create rundflug-leitstand --jurisdiction=eu
```

Die ausgegebenen `database_id`-Werte in `wrangler.jsonc` eintragen.

## 4. R2-Buckets in EU-Jurisdiktion anlegen

Prüfe zunächst die mit der installierten Wrangler-Version gültige Syntax:

```bash
npx wrangler r2 bucket create --help
```

Lege anschließend den Bucket `rundflug-leitstand` ausdrücklich mit EU-Jurisdiktion an. Der Bucket-Name
ist in `wrangler.jsonc` bereits als Binding vorgesehen.

## 5. Migrationen

```bash
npx wrangler d1 migrations apply rundflug-leitstand --remote
```

Vor Produktionsmigrationen: Backup erstellen, Migration in Abnahme prüfen und Wiederherstellungspfad
dokumentieren.

## 6. Deployment

### Workers Builds

Der im Cloudflare-Dashboard verbundene Worker heißt `rundflug-leitstand`. Solange die Anwendung noch
nicht produktiv genutzt wird, gibt es in Cloudflare bewusst nur diese eine Umgebung. Unter
**Settings → Build** gelten:

- Root directory: Repository-Wurzel
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy --config wrangler.jsonc`
- Non-production branch deploy command:
  `npx wrangler versions upload --config wrangler.jsonc`

Die D1-Migrationen laufen bewusst nicht implizit im Build. Sie werden vor dem ersten Acceptance-
Deployment und nach neuen Migrationen mit dem Befehl aus Abschnitt 5 angewendet. Worker-Name und die
in `wrangler.jsonc` eingetragene reale D1-ID müssen zusammenpassen. Lokale Entwicklung bleibt durch
den lokalen Startbefehl und lokale D1-Daten getrennt.

Vor dem Deployment je Umgebung den SHA-256-Hash der Administrator-PIN als Secret setzen. Die PIN
selbst wird weder in Cloudflare-Konfiguration noch D1 gespeichert:

```bash
npx wrangler secret put ADMIN_PIN_HASH
```

Zusätzlich einen einmaligen, zufälligen Einrichtungscode mit mindestens 16 Zeichen ausschließlich
interaktiv als Secret hinterlegen. Der Klartext wird danach nur einmal in `/setup` eingegeben und
nicht in D1 gespeichert:

```bash
npx wrangler secret put BOOTSTRAP_TOKEN
```

Nach Deployment und Migration `https://<worker-domain>/setup` öffnen. Dort Veranstaltungsdaten,
denselben Einrichtungscode und die zur Hashbildung verwendete Administrator-PIN eingeben. Der
Leitstand erzeugt das erste anonyme Administrationsgerät im Browser und sperrt den Setup-Endpunkt
anschließend dauerhaft. Demo-Seeds dürfen hierfür nicht verwendet werden.

Für Web-Push ein eigenes VAPID-Schlüsselpaar je Umgebung erzeugen. Die Ausgabe enthält den privaten
Schlüssel und darf nicht in Tickets, Chats oder Logs kopiert werden:

```bash
npx web-push generate-vapid-keys --json
```

Die drei Werte anschließend interaktiv als Cloudflare-Secrets setzen. Als `VAPID_SUBJECT` eine
erreichbare Betreiberadresse im Format `mailto:adresse@example.de` verwenden:

```bash
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT
```

Beim späteren Übergang auf getrennte Cloudflare-Umgebungen ein neues Schlüsselpaar für Produktion
erzeugen. Der private Schlüssel gehört niemals in `wrangler.jsonc`, `.env.example` oder D1.

Geräte werden über zufällige Kopplungstokens authentisiert; ausschließlich deren SHA-256-Hashes werden
in D1 gespeichert. Demo-Tokens aus dem lokalen Seed dürfen nicht in Acceptance oder Produktion
übernommen werden.

Danach:

```bash
npm run deploy
```

## 7. Domain und Monitoring

- eigene Subdomain, z. B. `leitstand.example.de`
- Statusbenachrichtigungen für Workers, D1, Durable Objects und R2 abonnieren
- Kostenwarnungen und CPU-Limits konfigurieren
- keine geplanten Deployments am Veranstaltungstag

## Automatisierter Betrieb

Der tägliche Cron erzeugt einen portablen D1-Export in R2, entfernt Sicherungen nach 14 Tagen und
löscht abgelaufene oder widerrufene Web-Push-Ziele. Wiederherstellung und Prüfschritte stehen in
`backup-restore.md`; der reale Wiederherstellungstest in Acceptance bleibt vor dem Echtbetrieb Pflicht.
