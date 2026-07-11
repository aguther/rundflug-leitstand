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
npx wrangler d1 create rundflug-leitstand-acceptance --jurisdiction=eu
npx wrangler d1 create rundflug-leitstand-production --jurisdiction=eu
```

Die ausgegebenen `database_id`-Werte in `wrangler.jsonc` eintragen.

## 4. R2-Buckets in EU-Jurisdiktion anlegen

Prüfe zunächst die mit der installierten Wrangler-Version gültige Syntax:

```bash
npx wrangler r2 bucket create --help
```

Lege anschließend die Buckets `rundflug-leitstand-acceptance-backups` und
`rundflug-leitstand-production-backups` ausdrücklich mit EU-Jurisdiktion an. Die Bucket-Namen sind in
`wrangler.jsonc` bereits als Bindings vorgesehen.

## 5. Migrationen

```bash
npx wrangler d1 migrations apply rundflug-leitstand-acceptance --remote --env acceptance
npx wrangler d1 migrations apply rundflug-leitstand-production --remote --env production
```

Vor Produktionsmigrationen: Backup erstellen, Migration in Abnahme prüfen und Wiederherstellungspfad
dokumentieren.

## 6. Deployment

Vor dem Deployment je Umgebung den SHA-256-Hash der Administrator-PIN als Secret setzen. Die PIN
selbst wird weder in Cloudflare-Konfiguration noch D1 gespeichert:

```bash
npx wrangler secret put ADMIN_PIN_HASH --env acceptance
npx wrangler secret put ADMIN_PIN_HASH --env production
```

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

## Noch nicht automatisiert

Die Startfassung implementiert noch keinen vollständigen D1-Export nach R2 und keine Push-Secrets.
Diese Punkte dürfen vor dem Echtbetrieb nicht als erledigt gelten.
