# Security Policy

## Melden von Sicherheitsproblemen

Sicherheitsprobleme nicht in öffentlichen Issues melden. Verwende einen internen, zugriffsgeschützten
Kanal des Vereins oder Repository-Eigentümers.

## Verbotene Repository-Inhalte

- Cloudflare API Tokens oder Global API Keys
- Administrator-PINs
- reale Telefonnummern oder Push-Subscriptions
- produktive Ticket-Tokens
- Datenbankexporte aus dem Echtbetrieb
- private Schlüssel oder VAPID-Secrets

## Mindestmaßnahmen

- privates Repository bis zur bewussten Veröffentlichung
- individuelle Konten statt gemeinsam genutzter Passwörter
- Zwei-Faktor-Authentifizierung für GitHub und Cloudflare
- getrennte Tokens für CI, Abnahme und Produktion
- minimal notwendige Token-Berechtigungen
- regelmäßige Wiederherstellungstests
