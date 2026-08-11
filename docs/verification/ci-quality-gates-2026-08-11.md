# Parallele CI-Qualitätsgates vom 11. August 2026

## Pull-Request-Nachweise

Der Workflow `.github/workflows/ci.yml` führt die risikorelevanten Nachweise nicht mehr seriell in
einem einzigen Job aus. Nach Checkout und festgelegter Node-/npm- beziehungsweise Python-Toolchain
starten folgende Jobs unabhängig voneinander:

| Job | Verbindlicher Nachweis |
| --- | --- |
| `check` | ehrlicher LCOV-Lauf mit Ratchets sowie `npm run check:ci` |
| `worker-runtime` | Web-Build und 23 Tests im echten Cloudflare-Worker-Pool; der Build stellt das vom Worker ausgelieferte Asset-Binding bereit |
| `v1-core` | Web-Build und die 18 V1-Kernintegrationssuiten mit isolierten lokalen D1-/Worker-Zuständen |
| `backup-restore` | isolierter Restore, Prüfsumme und Fremdschlüsselprüfung |
| `documentation` | arc42, Architektur-, Datenschutz-, Lizenz-, Rollen-, Migrations- und Requirements-Konsistenz |

Der Basisjob lädt ausschließlich `coverage/lcov.info` mit einem Tag Aufbewahrungszeit als
Workflow-Artefakt hoch. Der nachgelagerte Job `sonar` besitzt `needs: check`, lädt genau dieses
Artefakt und führt keinen zweiten abweichenden Coverage-Lauf aus. Bei internen Pull Requests und
Pushes auf `main` wartet der Scanner höchstens fünf Minuten auf das SonarQube Quality Gate;
`ERROR` oder Timeout lassen den Job fehlschlagen. Fork- und Dependabot-Pull-Requests erhalten wegen
der Secret-Grenze weiterhin alle lokalen Jobs, aber keinen Sonar-Upload.

## Sonar-Ausgangszustand vor Aktivierung

Die öffentliche SonarQube-Cloud-API meldete nach AP-05 weiterhin `ERROR`. Reliability, Security,
Maintainability, Duplikation und Security-Hotspot-Review bestanden; ausschließlich die Coverage auf
neuem Code lag mit 49,7 Prozent unter dem unveränderten Ziel von 80 Prozent. Gesamt-Coverage lag bei
47,7 Prozent, Line Coverage bei 45,9 Prozent und Branch Coverage bei 50,5 Prozent. Die Ausgangsmessung
zählte außerdem `scripts` als nicht instrumentierten Coverage-Quellraum, obwohl dieser nur Test-,
Build-, Betriebs- und Verifikationswerkzeuge enthält. Sonar analysiert diese Dateien weiterhin auf
Issues, nimmt sie aber analog zum lokalen Produktionscode-Ratchet unter `apps` und `packages` aus dem
Coverage-Nenner. Die eigene New-Code-Periode bleibt von den vier Vitest-Ratchets getrennt.

Der erste Main-Lauf mit `sonar.qualitygate.wait=true` wies diese bestehende Schuld folglich als roten
Status aus. Die Log- und API-Analyse zeigte zusätzlich, dass der NPM-Scanner keine Projektversion
übertrug: Alle Analysen liefen als `not provided`, sodass „Previous version“ seit dem 9. August 2026
keinen Versionswechsel erkennen konnte. `sonar.projectVersion` ist deshalb nun ausdrücklich an die
Root-Paketversion gekoppelt und testgesichert. Das etabliert die vorgesehene Versionsbaseline, ohne
den Schwellwert abzusenken oder das Warten abzuschalten. Pull Requests müssen ihre geänderten Zeilen
weiterhin zu mindestens 80 Prozent abdecken; der Bestandsabbau erfolgt über die nachfolgenden
Testarbeitspakete.

## Bewusst getrennte Abnahmen

Der V1-Abnahmetag, der zwölfstündige Soak-Test und externe Cloudflare-Verfügbarkeits- oder
Performance-Messungen bleiben separate, ausdrücklich ausgelöste Abnahmen. Sie würden die
Pull-Request-Rückmeldung unverhältnismäßig verlängern oder benötigen eine freigegebene externe
Umgebung. Der lokale synthetische Skalierungstest bleibt Teil der V1-Kernintegration.

Die parallelen Jobs ersetzen den vollständigen lokalen Nachweis `npm run check` nicht. Sie machen
in Pull Requests jedoch Worker-Laufzeit, D1-Kernabläufe, Restore und Dokumentation als getrennte,
referenzierbare Statusprüfungen sichtbar.

Der Dokumentations-Job installiert `pypdf` in der festgelegten Version `6.10.0`, weil
`docs:guides:check` die eingecheckten Rollen-PDFs auch in einem frischen GitHub-Runner semantisch
prüft. Die Abhängigkeit bleibt auf dieses Gate beschränkt und wird nicht Teil der Anwendung.
