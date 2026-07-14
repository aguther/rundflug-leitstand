# Hostingvergleich – geprüft am 14.07.2026

Die Preise und Kontingente sind zeitabhängig und vor einer Beschaffung erneut zu prüfen.

| Variante | Typische Mindestkosten | Vorteile | Nachteile für dieses Projekt | Einschätzung |
|---|---:|---|---|---|
| Cloudflare Workers + D1 + Durable Objects + R2 | Free für Entwicklung; Workers Paid mindestens 5 USD/Monat einschließlich Grundkontingenten | wenig Betriebsaufwand, globale Auslieferung, hibernierende WebSockets, Scale-to-zero | proprietäre Adapter, Self-Service-Tarif ohne individuell zugesicherte Betriebsbetreuung | empfohlener Standard; erwartete V1-Grundkosten einschließlich Domainreserve unter 8 EUR/Monat |
| Hetzner Cloud VPS | etwa 4 EUR/Monat für kleine Instanz, Zusatzkosten für Backups möglich | EU-Standorte, voller Linux-/PostgreSQL-Zugriff, sehr portabel | Betriebssystem, Patches, Monitoring, Backups, TLS, Hochverfügbarkeit und Realtime selbst betreiben | günstigster Geldpreis, höheres Betriebsrisiko |
| Railway Hobby | 5 USD Mindestnutzung/Monat | einfacher Container-/PostgreSQL-Betrieb, Rollbacks, wenig Serveradministration | nutzungsabhängige Kosten, Hobby-Workspace auf einen Entwickler ausgerichtet | gute Prototyp-Alternative |
| Firebase | Spark ggf. 0 USD, Blaze nutzungsabhängig | sehr einfacher Realtime-Start, Push-Ökosystem | NoSQL-Modell passt schlechter zu Audit-/Transaktionsanforderungen; Kostenmodell bei vielen Reads beachten | technisch möglich, aber Domänenmodell ungünstiger |
| Supabase | Free für Entwicklung; Pro ab 25 USD/Monat | PostgreSQL, Realtime, gute Portabilität | produktiver Tarif über dem 15-EUR-Ziel; Free-Projekte pausieren bei Inaktivität | fachlich attraktiv, aber teurer |
| Vercel/Netlify plus externe Datenbank | Frontend kostenlos möglich, produktive Teamtarife und Datenbank zusätzlich | sehr gute Frontend-Workflows | kein vollständiger Ersatz für Datenbank, seriellen Kommando-Koordinator und Realtime; Gesamtkosten meist höher | für dieses System kein Kostenvorteil |

## Entscheidungskriterium

Der Rundflug-Leitstand ist während weniger Veranstaltungstage betriebsintensiv, dazwischen fast inaktiv.
Deshalb ist ein Scale-to-zero-Modell wirtschaftlich. Ein VPS ist nominell etwas billiger, verursacht aber
laufende Betreiberpflichten. Für einen ehrenamtlichen Verein ist die eingesparte Administrationszeit in
der Regel mehr wert als die Differenz von ungefähr einem Euro pro Monat.

## Quellen zur erneuten Prüfung

- Cloudflare Workers: https://developers.cloudflare.com/workers/platform/pricing/
- Cloudflare D1: https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare Durable Objects: https://developers.cloudflare.com/durable-objects/platform/pricing/
- Hetzner Cloud: https://www.hetzner.com/cloud/
- Railway: https://railway.com/pricing
- Firebase: https://firebase.google.com/pricing
- Supabase: https://supabase.com/pricing
- Vercel: https://vercel.com/pricing
- Netlify: https://www.netlify.com/pricing/
