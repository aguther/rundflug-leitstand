# Web-Push-Betrieb

Web-Push setzt `@block65/webcrypto-web-push` ein, weil die Bibliothek den standardisierten
Web-Push-Payload ausschließlich mit Web Crypto erzeugt und damit ohne Node-spezifische
Krypto-Laufzeit im Cloudflare Worker funktioniert.

## Datenschutz und Aufbewahrung

- Web-Push wird nur nach aktiver Zustimmung im Browser registriert.
- Gespeichert werden Ticket-ID, Push-Endpunkt, Browser-Schlüssel, Einwilligungszeitpunkt und
  Löschzeitpunkt – keine Namen und keine Telefonnummern.
- Push-Ziele liegen in einer getrennten Tabelle und werden nicht in portable R2-Sicherungen aufgenommen.
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

Die D1-Migration `0006_web_push.sql` muss vor dem ersten Registrierungstest in der Zielumgebung
angewendet sein.
