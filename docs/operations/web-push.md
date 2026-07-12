# Web-Push-Betrieb

Web-Push setzt `@block65/webcrypto-web-push` ein, weil die Bibliothek den standardisierten
Web-Push-Payload ausschließlich mit Web Crypto erzeugt und damit ohne Node-spezifische
Krypto-Laufzeit im Cloudflare Worker funktioniert.

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

Für die gemeinsame Cloudflare-Umgebung wird ein P-256-VAPID-Schlüsselpaar benötigt. Der
öffentliche Schlüssel wird als Variable `VAPID_PUBLIC_KEY` bereitgestellt. Der private Schlüssel wird
ausschließlich als Secret `VAPID_PRIVATE_KEY` gespeichert. `VAPID_SUBJECT` ist eine `mailto:`-Adresse
oder eine HTTPS-URL des Betreibers.

Die D1-Migrationen `0006_web_push.sql` und `0021_web_push_delivery_queue.sql` müssen vor dem ersten
Registrierungs- und Zustellungstest in der Zielumgebung angewendet sein.

## Fachliche Auslösung

Die Statusseite zeigt das vom Prognosemodell berechnete Zeitfenster. Sobald dessen obere Grenze die
konfigurierte `notificationLeadMinutes`-Schwelle erreicht, wird einmalig „Bitte vorbereiten“
vorgemerkt. Unsichere Prognosen, Unterbrechung und Notfallmodus erzeugen keinen Vorbereitungshinweis.
`NEXT` erzeugt unabhängig davon den verbindlichen Aufruf „Bitte jetzt zur Flight Line kommen“.

Die Kasse gibt zu jedem Ticket den nicht erratbaren Status-QR-Code aus. Der Gast kann ihn direkt an
der Kasse mit dem eigenen Browser öffnen und dort Web-Push aktivieren; das Kassen- oder Helfergerät
übernimmt niemals das persönliche Browser-Abonnement.
