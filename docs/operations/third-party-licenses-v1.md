# Drittanbieter-Lizenzinventar – Release 1.10.0

Stand: automatisch aus installiertem Lockfile/Produktionsgraph erzeugt
Betroffene Anforderung: T-080 und V1100-DEP-010

## Ergebnis

`npm query ':not(.dev)' --json` meldet 32 externe Produktionspakete:
7 ISC, 24 MIT, 1 OFL-1.1. Kein Produktionspaket besitzt fehlende, `UNLICENSED`- oder proprietäre
Lizenzmetadaten.

Die frühere Abhängigkeit `@block65/webcrypto-web-push` und deren unlizenziertes Transitpaket
`@block65/custom-error` sind nicht enthalten. Web-Push verwendet die native Web-Crypto-API nach
RFC 8188, RFC 8291 und RFC 8292.

## Direkte Laufzeitabhängigkeiten

| Paket | Installierte Version | Lizenz |
| --- | --- | --- |
| `@fontsource/barlow-condensed` | 5.3.0 | OFL-1.1 |
| `hono` | 4.12.32 | MIT |
| `lucide-react` | 1.27.0 | ISC |
| `qrcode` | 1.5.4 | MIT |
| `zod` | 4.4.3 | MIT |

Interne Pakete unter `@rundflug/*` gehören zum selben privaten Repository. Das Lockfile ist die
versionsgenaue Quelle. Das Inventar wird mit `npm run docs:licenses:check` gegen den installierten
Produktionsgraph geprüft und mit `npm run docs:licenses:build` aktualisiert.

## Sicherheits- und Rechtehinweis

`npm audit --omit=dev` ist vor Freigabe auszuführen. Der am 26. Juli 2026 verbleibende npm-Befund
betrifft ausschließlich die Buildkette von `vite-plugin-pwa`/Workbox; es gibt derzeit keine mit
Vite 8 kompatible gefixte Upstreamversion. Dependabot überwacht die Kette wöchentlich. Sie verarbeitet
keine Laufzeitanfragen oder fremden Projektdateien im Worker.

Dieses technische Inventar ersetzt keine rechtsverbindliche Rechteübertragung am projektspezifischen
Quellcode. `LICENSE.md` bleibt bis zur Entscheidung der berechtigten Parteien auf „alle Rechte
vorbehalten“. Nutzungsrecht, Lizenztext und Übergabeprotokoll bleiben als OQ-13 offen.
