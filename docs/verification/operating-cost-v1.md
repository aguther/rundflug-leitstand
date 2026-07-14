# Betriebskostennachweis V1

Stand: 14. Juli 2026

Betroffene Anforderung: Q-WAR-030.

## Aktuelle Preisgrundlage

Die offiziellen Cloudflare-Preisunterlagen wurden am 14. Juli 2026 erneut geprüft:

- Workers Paid: mindestens 5 USD pro Account und Monat einschließlich Grundkontingenten für
  Workers und Durable Objects.
- D1 Paid: 25 Milliarden gelesene und 50 Millionen geschriebene Zeilen sowie 5 GB Speicher pro
  Monat enthalten; D1 skaliert ohne feste Compute-Kapazitätskosten auf null.
- Durable Objects Paid: eine Million Requests und 400.000 GB-s pro Monat enthalten; die Anwendung
  verwendet die WebSocket-Hibernation-API (`acceptWebSocket`), sodass inaktive Verbindungen keine
  dauerhafte Compute-Laufzeit verursachen.
- R2 Standard: 10 GB, eine Million Class-A- und zehn Millionen Class-B-Operationen pro Monat im
  kostenlosen Kontingent; kein Egresspreis.

Quellen:

- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/r2/pricing/

## Abgleich mit dem V1-Mengengerüst

Der reale Acceptance-Stand lag bei 458.752 Byte D1-Daten, 13.505 gelesenen und 1.564 geschriebenen
D1-Zeilen in 24 Stunden. R2 enthielt vier Objekte mit zusammen 57,9 kB. Der synthetische
Skalierungstest deckt 20 gleichzeitige Geräte, 1.000 Tickets, 300 offene Umläufe und 6.000
Historienereignisse ab.

Selbst bei durchgängiger Nutzung des Workers-Paid-Grundtarifs bleiben D1, R2 und Durable Objects bei
diesem Mengengerüst innerhalb der enthaltenen Kontingente. Konservative monatliche Grundplanung:

| Position | Planwert |
| --- | ---: |
| Cloudflare Workers Paid einschließlich Grundkontingente | 5 USD |
| TLS-Zertifikat | 0 EUR |
| optionale eigene Domain, Budgetreserve | 2 EUR |
| erwartete Grundsumme | unter 8 EUR |

Damit verbleibt ein deutlicher Abstand zur Grenze von 15 EUR. Mobilfunk, freiwillige externe
Versanddienste und außergewöhnliche Mehrnutzung sind gemäß Anforderung nicht Teil der Grundkosten.
Kostenwarnungen und die erneute Prüfung vor dem Echtbetrieb bleiben Bestandteil der
Cloudflare-Betriebsanleitung.
