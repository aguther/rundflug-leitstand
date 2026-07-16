# Web-Push-Betrieb

Web-Push erzeugt den standardisierten `aes128gcm`-Payload und die VAPID-Authentifizierung direkt mit
der nativen Web-Crypto-API des Cloudflare Workers nach RFC 8188, RFC 8291 und RFC 8292. Dafür wird
keine zusätzliche Web-Push-Kryptobibliothek eingesetzt. Der kryptografische Regressionstest
`apps/worker/src/web-push-request.test.ts` entschlüsselt ein erzeugtes Paket wieder und verifiziert
die VAPID-Signatur.

## Datenschutz und Aufbewahrung

- Web-Push wird nur nach aktiver Zustimmung im Browser registriert.
- Gespeichert werden Ticket-ID, Push-Endpunkt, Browser-Schlüssel, Einwilligungszeitpunkt und
  Löschzeitpunkt – keine Namen und keine Telefonnummern.
- Push-Ziele liegen in einer getrennten Tabelle und werden nicht in portable R2-Sicherungen aufgenommen.
- Vorbereitung, Aufruf und Umlaufstatus werden zunächst als deduplizierter Zustellauftrag erfasst.
  Pro Abonnement, Umlauf und Hinweistyp existiert höchstens ein Auftrag. Ohne vollständige
  VAPID-Konfiguration bleibt er auslieferbar vorgemerkt, statt still verloren zu gehen.
- Die Aufbewahrungsfrist wird mit `PUSH_RETENTION_DAYS` konfiguriert (zulässig: 1 bis 30 Tage,
  Standard: 7) und beginnt am festgelegten Veranstaltungsende. Ohne Veranstaltungsende ist keine
  Registrierung möglich.
- Nach Ablauf der Frist werden Ziele nicht mehr verwendet; der tägliche Cron löscht sie ebenso wie
  widerrufene oder technisch abgelaufene Einträge. Nach Fristablauf werden keine neuen Ziele mehr
  angenommen.
- Push-Endpunkte oder Schlüssel dürfen niemals geloggt werden.

## Cloudflare-Konfiguration

Für die gemeinsame Cloudflare-Umgebung wird ein P-256-VAPID-Schlüsselpaar benötigt. Der öffentliche
Schlüssel wird als Binding `VAPID_PUBLIC_KEY` bereitgestellt; der private Schlüssel liegt
ausschließlich im Secret `VAPID_PRIVATE_KEY`. `VAPID_SUBJECT` ist eine `mailto:`-Adresse oder eine
HTTPS-URL des Betreibers. Das Einrichtungswerkzeug überträgt alle drei gemeinsam als Secrets, damit
kein Wert versehentlich in der versionierten Konfiguration landet.

Die drei Werte werden ohne Ausgabe oder lokale Speicherung des privaten Schlüssels eingerichtet:

```bash
npm run cloudflare:configure-push
```

In nicht interaktiven Betriebsumgebungen kann der öffentlich sichtbare Kontakt ausdrücklich als
Argument übergeben werden; private Schlüssel oder andere Secrets dürfen nie als Argument folgen:

```bash
npm run cloudflare:configure-push -- --subject https://<worker-domain>/
```

Anschließend muss `/api/public/push/config` mit HTTP 200 antworten. HTTP 503 mit
`PUSH_NOT_CONFIGURED` bedeutet, dass die V1-Browserbenachrichtigung noch nicht betriebsbereit ist.

Die D1-Migrationen `0006_web_push.sql` und `0021_web_push_delivery_queue.sql` müssen vor dem ersten
Registrierungs- und Zustellungstest in der Zielumgebung angewendet sein.

## Fachliche Auslösung

Die Statusseite zeigt das vom Prognosemodell berechnete Zeitfenster. Erreicht eine Gruppe unter
Berücksichtigung von Queue-Position, Prognosequalität und maximaler Gate-Wartezeit den
konfigurierten Vorlauf, wird einmalig „Bitte zum Gate“/`GO TO GATE` vorgemerkt. Unsichere Prognosen,
Unterbrechung und Notfallmodus erzeugen keinen automatischen Voraufruf. `NEXT` bleibt davon getrennt
und erzeugt nach menschlicher Bestätigung den verbindlichen Boardingaufruf.

Die Kasse gibt zu jedem Ticket den nicht erratbaren Status-QR-Code aus. Der Gast kann ihn direkt an
der Kasse mit dem eigenen Browser öffnen und dort Web-Push aktivieren; das Kassen- oder Helfergerät
übernimmt niemals das persönliche Browser-Abonnement.
