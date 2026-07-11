# Web-Push-Betrieb

Web-Push setzt `@block65/webcrypto-web-push` ein, weil die Bibliothek den standardisierten
Web-Push-Payload ausschließlich mit Web Crypto erzeugt und damit ohne Node-spezifische
Krypto-Laufzeit im Cloudflare Worker funktioniert.

## Datenschutz und Aufbewahrung

- Web-Push wird nur nach aktiver Zustimmung im Browser registriert.
- Gespeichert werden Ticket-ID, Push-Endpunkt, Browser-Schlüssel, Einwilligungszeitpunkt und
  Löschzeitpunkt – keine Namen und keine Telefonnummern.
- Push-Ziele liegen in einer getrennten Tabelle und werden nicht in portable R2-Sicherungen aufgenommen.
- Widerrufene, technisch abgelaufene und mehr als sieben Tage alte Einträge löscht der tägliche Cron.
- Push-Endpunkte oder Schlüssel dürfen niemals geloggt werden.

## Cloudflare-Konfiguration

Für Acceptance und Produktion wird jeweils ein eigenes P-256-VAPID-Schlüsselpaar empfohlen. Der
öffentliche Schlüssel wird als Variable `VAPID_PUBLIC_KEY` bereitgestellt. Der private Schlüssel wird
ausschließlich als Secret `VAPID_PRIVATE_KEY` gespeichert. `VAPID_SUBJECT` ist eine `mailto:`-Adresse
oder eine HTTPS-URL des Betreibers.

Die konkreten Einrichtungsbefehle werden erst nach dem lokalen Abnahmetest ausgeführt. Die D1-Migration
`0006_web_push.sql` muss vor dem ersten Registrierungstest in der Zielumgebung angewendet sein.
