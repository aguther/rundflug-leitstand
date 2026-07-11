# Code-Review-Leitfaden

## Fachlichkeit

- Sind alle im Pull Request genannten Anforderungs-IDs tatsächlich erfüllt?
- Werden Gruppenbindungen, Queue-Reihenfolge und die Sperre automatischer Umbesetzung nach `NEXT`
  eingehalten?
- Bleiben Plan-, Prognose- und Ist-Zeit getrennt?
- Wird `GELANDET` nicht mit `VERFÜGBAR` gleichgesetzt?

## Konsistenz und Concurrency

- Besitzt jedes Kommando eine Idempotenz-ID und erwartete Version?
- Werden stale writes sichtbar abgelehnt?
- Erfolgt die Realtime-Veröffentlichung erst nach Persistenz?
- Können Retries doppelte Tickets, Zahlungen oder Zustandswechsel erzeugen?

## Sicherheit und Datenschutz

- Ist die Aktion rollenbezogen autorisiert?
- Sind öffentliche Ticketcodes nicht erratbar und nicht aufzählbar?
- Gelangen Telefonnummern, Tokens, PINs oder Secrets in Logs, Fehlertexte oder Analytics?
- Sind öffentliche Antworten minimal und ticketspezifisch?

## Betrieb

- Funktioniert der Kernablauf bei kurzfristiger Offline-Situation nachvollziehbar?
- Sind Migration, Backup und Wiederherstellung berücksichtigt?
- Bleiben Test-/Abnahme- und Produktionsressourcen getrennt?

## UI

- Ist die Primäraktion eindeutig und fingergeeignet?
- Bleibt der Regelfall ohne Menünavigation?
- Sind Status nicht nur durch Farbe unterscheidbar?
- Funktioniert die Oberfläche auf Tablet, Smartphone und 16:9-Monitor?
