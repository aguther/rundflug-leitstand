# Befristeter Wrangler-D1-Concurrency-Workaround vom 12. August 2026

## Befund

Der CI-Lauf `31600607959` endete sporadisch mit HTTP 500 beim öffentlichen Ticketstatus, während
die Public-Monitors-Suite isoliert und im nachfolgenden vollständigen V1-Integrationslauf bestand.
Das Fehlerbild entspricht der von Cloudflare bestätigten Regression
[`cloudflare/workers-sdk#14916`](https://github.com/cloudflare/workers-sdk/issues/14916): Ab
Wrangler 4.114 kann ein vorübergehendes `SQLITE_BUSY` beim lokalen D1-Zugriff den gesamten
`wrangler dev`-Prozess beenden. Wrangler 4.112 mit Miniflare `4.20260714.0` ist laut
Upstream-Reproduktion nicht betroffen.

Der vorgeschlagene Fix
[`cloudflare/workers-sdk#14921`](https://github.com/cloudflare/workers-sdk/pull/14921) ist zum
Zeitpunkt dieser Entscheidung weiterhin offen. Auch Wrangler 4.122 enthält ihn laut Release Notes
nicht.

## Entscheidung und Geltungsbereich

- Die direkt verwendete Dev-Dependency `wrangler` wird exakt auf `4.112.0` festgesetzt.
- Damit verwenden die lokalen Wrangler-Dev-Integrationen Miniflare `4.20260714.0` und
  Workerd `1.20260714.1`.
- `@cloudflare/vitest-pool-workers` behält seine eigene, im Lockfile sichtbare Wrangler-/Miniflare-
  Linie. Sie verwendet nicht den HTTP-Dev-Server-Pfad, auf den sich die Regression bezieht.
- Das Installationsskript für den älteren Workerd-Binärwrapper ist versionsscharf freigegeben. Das
  für die vorhandenen Tests nicht benötigte Sharp-Installationsskript bleibt ausdrücklich gesperrt.
- Die Public-Monitors-Suite puffert nur das letzte begrenzte Stück der Wrangler-Ausgabe. Bei einem
  HTTP-Fehler nennt sie Status, einen auf 2.048 Zeichen begrenzten Response-Body und diesen
  Runtime-Auszug. Alle Testdaten sind synthetisch; Secrets werden weiterhin nicht ausgegeben.

Der Pin verändert weder den produktiven Worker noch dessen Deployment-Abhängigkeiten. Wrangler,
Miniflare, Workerd, Sharp und Undici sind ausschließlich Dev-/CI-Werkzeuge und werden nicht in das
Produktionsbundle aufgenommen.

## Sicherheitsabwägung

`npm audit` meldet für die ältere lokale Toolchain vier Befunde: einen moderaten Wrangler-/Miniflare-
Befund und drei hohe transitive Befunde über Sharp beziehungsweise Undici. Die betroffenen Pakete
verarbeiten in diesem Repository innerhalb der Tests ausschließlich kontrollierte lokale Requests
und versionierte Assets. Das Expositionsrisiko ist deshalb begrenzt, aber nicht null.

Die Meldungen werden nicht durch ungeprüfte Overrides unterdrückt: Sharp 0.35 oder eine neuere
Miniflare-Linie würden den verifizierten Upstream-Stand verändern und könnten den Workaround
unwirksam machen. Der zeitlich begrenzte Dev-Tool-Risikozuwachs wird gegenüber dem real beobachteten
Ausfall der Integrationsvalidierung akzeptiert. Für produktive Abhängigkeiten gilt diese Abwägung
ausdrücklich nicht.

## Verbindlicher Neubewertungsauslöser

Der Pin muss entfernt und durch die erste audit-freie Wrangler-Version ersetzt werden, die den
Upstream-Fix nachweislich enthält. Dafür sind vor dem Upgrade mindestens erforderlich:

1. Fix-PR `#14921` oder ein gleichwertiger Maintainer-Fix ist gemergt und in einer Release Note
   referenziert.
2. `npm audit` enthält keine durch den Pin eingeführten Befunde mehr.
3. `test:public-monitors` und `test:v1-integrations` bestehen mit der neuen Version.
4. Die begrenzte Fehlerdiagnostik bleibt als Regressionserleichterung erhalten.

## Validierungsnachweise

- Der gezielte Public-Monitors-Lauf bestand vollständig mit Wrangler 4.112.
- Die V1-Integrationsmatrix mit 18 Suiten und maximal zwei parallelen Suiten bestand zweimal
  hintereinander in 381,6 beziehungsweise 380,5 Sekunden. Public Monitors lief dabei jeweils im
  isolierten Parallelpfad.
- `npm run check` bestand einschließlich 308 Testdateien und 1.680 Tests, Typecheck,
  Produktionsbundles, Worker-Runtime, Acceptance-Day, Backup/Restore, Dokumentations- und
  Requirements-Prüfungen.
- `npm audit` bleibt mit einem moderaten und drei hohen, ausschließlich der befristeten
  Dev-Toolchain zugeordneten Befunden offen. Diese Befunde sind Teil der obigen Abwägung und kein
  erfolgreich bestandener Check.
