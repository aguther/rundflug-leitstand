# Drittanbieter-Lizenzinventar – Release 1.12.0

Stand: automatisch aus installiertem Lockfile/Produktionsgraph erzeugt
Betroffene Anforderungen: T-080, V1100-DEP-010 und V1120-DEP-010

## Ergebnis

`npm ls --omit=dev --all --json --long` meldet 82 externe Produktionspakete:
1 BSD-3-Clause, 19 ISC, 60 MIT, 1 MIT AND ISC, 1 OFL-1.1. Kein Produktionspaket besitzt fehlende, `UNLICENSED`- oder proprietäre
Lizenzmetadaten.

Die frühere Abhängigkeit `@block65/webcrypto-web-push` und deren unlizenziertes Transitpaket
`@block65/custom-error` sind nicht enthalten. Web-Push verwendet die native Web-Crypto-API nach
RFC 8188, RFC 8291 und RFC 8292.

## Direkte Laufzeitabhängigkeiten

| Paket | Installierte Version | Lizenz |
| --- | --- | --- |
| `@fontsource/barlow-condensed` | 5.3.0 | OFL-1.1 |
| `fflate` | 0.8.3 | MIT |
| `hono` | 4.13.2 | MIT |
| `lucide-react` | 1.31.0 | ISC |
| `qrcode` | 1.5.4 | MIT |
| `react` | 19.2.8 | MIT |
| `react-dom` | 19.2.8 | MIT |
| `react-is` | 19.2.8 | MIT |
| `recharts` | 3.10.1 | MIT |
| `workbox-window` | 7.4.1 | MIT |
| `zod` | 4.4.3 | MIT |

Interne Pakete unter `@rundflug/*` gehören zum selben privaten Repository. Das Lockfile ist die
versionsgenaue Quelle. Das Inventar wird mit `npm run docs:licenses:check` gegen den installierten
Produktionsgraph geprüft und mit `npm run docs:licenses:build` aktualisiert.

## Sicherheits- und Rechtehinweis

`npm audit` und `npm audit --omit=dev` sind vor Freigabe auszuführen. Der am 3. August 2026
geprüfte Lockfile-Stand enthält keine bekannten npm-Sicherheitsbefunde. Dependabot überwacht die
Abhängigkeiten weiterhin wöchentlich. Die Entwicklungs- und Buildkette verarbeitet keine
Laufzeitanfragen oder fremden Projektdateien im Worker.

Dieses technische Inventar ersetzt keine rechtsverbindliche Rechteübertragung am projektspezifischen
Quellcode. `LICENSE.md` bleibt bis zur Entscheidung der berechtigten Parteien auf „alle Rechte
vorbehalten“. Nutzungsrecht, Lizenztext und Übergabeprotokoll bleiben als OQ-13 offen.
