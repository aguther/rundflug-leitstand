# Verifikation Transportverschlüsselung V1

Außerhalb der lokalen Entwicklungsumgebung leitet der Worker jede HTTP-Anfrage mit Status 308 auf
dieselbe HTTPS-Ressource um. Pfad und Query-Parameter bleiben erhalten. Der lokale Worker bleibt für
die Entwicklung über `http://127.0.0.1` erreichbar.

Der Unit-Test in `apps/worker/src/transport-security.test.ts` prüft Weiterleitung, Pfadtreue, HTTPS
und die lokale Ausnahme. Der vollständige Projektcheck umfasst diesen Test.

Am 12.07.2026 wurde das Cloudflare-Deployment unter
`rundflug-leitstand.andreas-7f3.workers.dev` zusätzlich live geprüft:

- HTTP `/api/health?tls-probe=1`: `308 Permanent Redirect` auf die identische HTTPS-URL.
- HTTPS `/api/health?tls-probe=1`: `200 OK`.
- HTTPS-Antwort: HSTS mit `includeSubDomains`, Content Security Policy, `no-referrer`, `nosniff` und
  Schutz vor Einbettung in fremde Frames.

Damit ist auch der Erstkontakt serverseitig auf TLS erzwungen; HSTS schützt weitere Browserzugriffe.
