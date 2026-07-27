# Web-Push-Betrieb

Web-Push erzeugt den standardisierten `aes128gcm`-Payload und die VAPID-Authentifizierung direkt mit
der nativen Web-Crypto-API des Cloudflare Workers nach RFC 8188, RFC 8291 und RFC 8292. Dafür wird
keine zusätzliche Web-Push-Kryptobibliothek eingesetzt. Der kryptografische Regressionstest
`apps/worker/src/web-push-request.test.ts` entschlüsselt ein erzeugtes Paket wieder und verifiziert
die VAPID-Signatur.

## Deklarative iOS-Nachrichten

Der Payload folgt dem deklarativen Format (`web_push: 8030`), damit Safari ab iOS 18.4 die
Mitteilung ohne laufenden Service Worker anzeigt. Safari parst das Feld `navigate` ohne Basis-URL
und verwirft die gesamte Nachricht, sobald daraus keine gültige URL entsteht; ein relativer Pfad
ist damit unzustellbar. Der Ursprung der Statusseite wird deshalb bei der Einwilligung aus der
Registrierungsanfrage übernommen und je Abonnement gespeichert (Migration `0051_web_push_origin.sql`).

Ohne gespeicherten HTTPS-Ursprung – Bestandsabonnements vor dieser Migration sowie lokale
HTTP-Entwicklungsumgebungen – wird bewusst der klassische Payload ohne `web_push`-Schlüssel
gesendet. Er wird vom Service Worker angezeigt, statt von Safari verworfen zu werden. Ein solches
Abonnement erhält seinen Ursprung bei der nächsten Einwilligung.

## Erneuerte Abonnements

Browser dürfen ein Push-Abonnement jederzeit austauschen. Der Service Worker beantwortet
`pushsubscriptionchange`, erzeugt das Ziel neu und hebt die bestehende Einwilligung über
`POST /api/public/push/subscriptions/refresh` auf den neuen Endpunkt. Ticketbindung, Ursprung und
Löschfrist bleiben dabei unverändert, weil der Eintrag an Ort und Stelle fortgeschrieben wird.

Die Anfrage weist sich allein über den bisherigen Endpunkt aus; dieser ist ein nicht erratbares
Geheimnis des jeweiligen Browsers. Ein unbekannter oder abgelaufener Vorgänger wird mit HTTP 404
abgewiesen. Safari unterstützt `pushsubscriptionchange` bislang nicht zuverlässig – dort bleibt der
Widerruf beim nächsten Zustellversuch (HTTP 404/410) der maßgebliche Weg.

## Betriebsprotokolle

Der Versand protokolliert ausschließlich pseudonyme Felder – Zustellauftrag, Hinweistyp,
HTTP-Status und den Namen des Push-Dienstes. Endpunkte und Schlüssel bleiben ausgeschlossen; auch
Fehlermeldungen werden vor der Ausgabe um URLs bereinigt.

| Code | Bedeutung |
| --- | --- |
| `WEB_PUSH_NOT_CONFIGURED` | VAPID unvollständig; Aufträge bleiben vorgemerkt, es geht nichts raus |
| `WEB_PUSH_DELIVERY_REJECTED` | Push-Dienst hat abgelehnt, etwa HTTP 403 bei unpassendem Schlüsselpaar |
| `WEB_PUSH_SUBSCRIPTION_EXPIRED` | Ziel ist beim Dienst erloschen und wurde stillgelegt |
| `WEB_PUSH_DELIVERY_FAILED` | Versand ist vor der Antwort gescheitert, etwa durch einen Netzfehler |

## Datenschutz und Aufbewahrung

- Web-Push wird nur nach aktiver Zustimmung im Browser registriert.
- Gespeichert werden Ticket-ID, Push-Endpunkt, Browser-Schlüssel, Einwilligungszeitpunkt,
  Löschzeitpunkt und der Ursprung der Statusseite – keine Namen und keine Telefonnummern.
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

Anschließend muss `/api/public/push/config` mit HTTP 200 antworten. Die Auskunft prüft alle drei
Werte, nicht nur den öffentlichen Schlüssel: Eine unvollständige Einrichtung meldet HTTP 503 mit
`PUSH_NOT_CONFIGURED` und die Statusseite bietet die Einwilligung gar nicht erst an, statt sie
folgenlos entgegenzunehmen.

Die D1-Migrationen `0006_web_push.sql` und `0021_web_push_delivery_queue.sql` müssen vor dem ersten
Registrierungs- und Zustellungstest in der Zielumgebung angewendet sein.

## Fachliche Auslösung

Die Statusseite zeigt das vom Prognosemodell berechnete Zeitfenster. Erreicht eine Gruppe unter
Berücksichtigung von Queue-Position, Prognosequalität und maximaler Gate-Wartezeit den
konfigurierten Vorlauf, wird einmalig „Bitte zum Gate“/`GO TO GATE` vorgemerkt. Unsichere Prognosen,
Unterbrechung und Notfallmodus erzeugen keinen automatischen Voraufruf. Die menschliche Bestätigung
„Belegung bestätigen & Boarding starten“ (`CALL_NEXT`) bleibt davon getrennt
und erzeugt nach menschlicher Bestätigung den verbindlichen Boardingaufruf.

Die Kasse gibt zu jedem Ticket den nicht erratbaren Status-QR-Code aus. Der Gast kann ihn direkt an
der Kasse mit dem eigenen Browser öffnen und dort Web-Push aktivieren; das Kassen- oder Helfergerät
übernimmt niemals das persönliche Browser-Abonnement.
