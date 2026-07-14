# Drittanbieter-Lizenzinventar V1

Stand: 14. Juli 2026  
Betroffene Anforderung: T-080

## Ergebnis

Der installierte Produktionsabhängigkeitsgraph wurde nach `npm install` mit
`npm query ':not(.dev)' --json` gegen die Paketmetadaten unter `node_modules` geprüft. Er enthält 33
externe Pakete: 27 unter MIT und 6 unter ISC. Kein Produktionspaket besitzt fehlende,
`UNLICENSED`- oder proprietäre Lizenzmetadaten.

Die zuvor direkte Abhängigkeit `@block65/webcrypto-web-push` und deren ausdrücklich
unlizenziertes Transitpaket `@block65/custom-error` wurden entfernt. Web-Push bleibt erhalten und
wird in `apps/worker/src/web-push-request.ts` ausschließlich mit der nativen Web-Crypto-API nach
RFC 8188, RFC 8291 und RFC 8292 erzeugt. Der Test
`apps/worker/src/web-push-request.test.ts` entschlüsselt das erzeugte `aes128gcm`-Paket wieder und
verifiziert die VAPID-Signatur kryptografisch.

## Direkte Laufzeitabhängigkeiten

| Paket | Version | Lizenz | Einsatz |
| --- | --- | --- | --- |
| `hono` | 4.12.29 | MIT | Worker-HTTP-Routing |
| `zod` | 4.4.3 | MIT | Laufzeitvalidierung und Verträge |
| `qrcode` | 1.5.4 | MIT | anonyme Ticket- und Gerätekopplungs-QR-Codes |
| `react` | 19.2.7 | MIT | Weboberfläche |
| `react-dom` | 19.2.7 | MIT | Browser-Rendering |
| `workbox-window` | 7.4.1 | MIT | PWA-/Service-Worker-Anbindung |

Die Pakete unter `@rundflug/*` sind interne, nicht veröffentlichte Workspace-Pakete desselben
Repositories. Für Build, Test und Deployment werden zusätzlich nur Pakete mit MIT-, ISC-, Apache-,
BSD-, MPL-, BlueOak-, CC- oder LGPL-Metadaten verwendet; sie werden nicht als eigenständige
proprietäre Laufzeitdienste benötigt. Das Lockfile ist die versionsgenaue Quelle des Inventars.

## Reproduzierbare Prüfung

```bash
npm install
npm ls @block65/webcrypto-web-push @block65/custom-error --all
npm query ':not(.dev)' --json
npm run check
```

Der erste Befehl mit `npm ls` muss `(empty)` liefern. Die Abhängigkeits-Allowlist und die Abwesenheit
der entfernten Pakete werden zusätzlich in
`apps/worker/src/maintainability-coverage.test.ts` geprüft.

## Verbleibende Rechteentscheidung

Dieses Inventar beseitigt den technischen Drittanbieter-Lizenzblocker, ersetzt aber keine
rechtsverbindliche Rechteübertragung am projektspezifischen Quellcode. `LICENSE.md` bleibt bis zur
ausdrücklichen Entscheidung der berechtigten Parteien auf „alle Rechte vorbehalten“. T-080 bleibt
deshalb formal in Arbeit, bis Nutzungsrecht, Lizenztext und Übergabeprotokoll freigegeben sind.
