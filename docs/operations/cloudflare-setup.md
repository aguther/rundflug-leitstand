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
npx wrangler d1 create rundflug-leitstand-production --jurisdiction=eu
```

Die ausgegebenen `database_id`-Werte in `wrangler.jsonc` eintragen.

## 4. R2-Buckets in EU-Jurisdiktion anlegen

Prüfe zunächst die mit der installierten Wrangler-Version gültige Syntax:

```bash
npx wrangler r2 bucket create --help
```

Lege anschließend die Buckets `rundflug-leitstand` und
`rundflug-leitstand-production-backups` ausdrücklich mit EU-Jurisdiktion an. Die Bucket-Namen sind in
`wrangler.jsonc` bereits als Bindings vorgesehen.

## 5. Migrationen

```bash
npx wrangler d1 migrations apply rundflug-leitstand --remote --env acceptance
npx wrangler d1 migrations apply rundflug-leitstand-production --remote --env production
```

Vor Produktionsmigrationen: Backup erstellen, Migration in Abnahme prüfen und Wiederherstellungspfad
dokumentieren.

## 6. Deployment

### Workers Builds für Acceptance

Der im Cloudflare-Dashboard verbundene Worker muss `rundflug-leitstand-acceptance` heißen. Für den
ersten Test nicht den Worker `rundflug-leitstand` verwenden; dieser Name ist für Produktion
reserviert. Unter **Settings → Build** gelten:

- Root directory: Repository-Wurzel
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy --env acceptance --config wrangler.jsonc`
- Non-production branch deploy command:
  `npx wrangler versions upload --env acceptance --config wrangler.jsonc`

Die D1-Migrationen laufen bewusst nicht implizit im Build. Sie werden vor dem ersten Acceptance-
Deployment und nach neuen Migrationen mit dem Befehl aus Abschnitt 5 angewendet. Worker-Name,
Wrangler-Environment und die in `wrangler.jsonc` eingetragene reale D1-ID müssen zusammenpassen.

Vor dem Deployment je Umgebung den SHA-256-Hash der Administrator-PIN als Secret setzen. Die PIN
selbst wird weder in Cloudflare-Konfiguration noch D1 gespeichert:

```bash
npx wrangler secret put ADMIN_PIN_HASH --env acceptance
npx wrangler secret put ADMIN_PIN_HASH --env production
```

Für Web-Push ein eigenes VAPID-Schlüsselpaar je Umgebung erzeugen. Die Ausgabe enthält den privaten
Schlüssel und darf nicht in Tickets, Chats oder Logs kopiert werden:

```bash
npx web-push generate-vapid-keys --json
```

Die drei Werte anschließend interaktiv als Cloudflare-Secrets setzen. Als `VAPID_SUBJECT` eine
erreichbare Betreiberadresse im Format `mailto:adresse@example.de` verwenden:

```bash
npx wrangler secret put VAPID_PUBLIC_KEY --env acceptance
npx wrangler secret put VAPID_PRIVATE_KEY --env acceptance
npx wrangler secret put VAPID_SUBJECT --env acceptance
```

Für Produktion ein neues Schlüsselpaar erzeugen und dieselben drei Befehle mit `--env production`
ausführen. Der private Schlüssel gehört niemals in `wrangler.jsonc`, `.env.example` oder D1.

Geräte werden über zufällige Kopplungstokens authentisiert; ausschließlich deren SHA-256-Hashes werden
in D1 gespeichert. Demo-Tokens aus dem lokalen Seed dürfen nicht in Acceptance oder Produktion
übernommen werden.

Danach:

```bash
npm run deploy:acceptance
npm run deploy:production
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
