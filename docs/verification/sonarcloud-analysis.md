# SonarQube-Cloud-Analyse

Die SonarQube-Cloud-Analyse ist ein zusätzlicher, serverabhängiger Qualitätsnachweis. Der lokale
Build und die vollständige Repository-Prüfung bleiben davon getrennt und funktionieren ohne
Netzwerkzugriff oder SonarQube-Verfügbarkeit:

```text
npm run build
npm run check
```

## Lokaler Analyselauf

`npm run sonar` führt zuerst die Vitest-Suite mit LCOV-Ausgabe unter `coverage/lcov.info` aus und
startet danach den im Lockfile versionierten NPM-Scanner. Für die Übermittlung muss `SONAR_TOKEN` in
der Umgebung gesetzt sein. Der Wert darf weder in das Repository noch in Shell-Historien, Logs oder
Kommandozeilenparameter geschrieben werden.

Der instrumentierte Coverage-Lauf lässt die rechenintensiven Forecast-Simulationen in
`engine.test.ts` und `comparison.test.ts` aus. Die V8-Instrumentierung verlängert diese Tests so stark,
dass ihre für normale Testläufe bemessenen Zeitgrenzen überschritten werden. Beide Dateien bleiben
vollständig Bestandteil von `npm test`, `npm run build` und `npm run check`. Die übrigen Unit- und
Integrationstests erzeugen weiterhin den LCOV-Bericht für die SonarQube-Analyse.

```text
npm run sonar
```

Die Projektkennung, Organisation, Quellen, Testdateien und der LCOV-Pfad liegen nachvollziehbar in
`sonar-project.properties`. Die Abhängigkeiten `@sonar/scan` und `@vitest/coverage-v8` dienen
ausschließlich dem optionalen Analyselauf und verändern den normalen Build nicht.

Die New-Code-Definition verwendet „Previous version“. Deshalb überträgt
`sonar.projectVersion` ausdrücklich dieselbe Version wie das Root-Paket; ein Test verhindert, dass
beide Werte auseinanderlaufen oder der Scanner erneut die künstliche Version `not provided`
verwendet. Ohne den Parameter betrachtete SonarQube Cloud sämtliche Änderungen seit der ersten
Analyse vom 9. August 2026 als einen einzigen New-Code-Zeitraum. Dies erklärte das trotz erfolgreichem
LCOV-Import rote Gate mit 49,9 Prozent. Mit der expliziten Version beginnt der Zeitraum gemäß der
[SonarQube-Cloud-Dokumentation](https://docs.sonarsource.com/sonarqube-cloud/standards/about-new-code#previous-version)
bei der ersten Analyse dieser Applikationsversion. Pull Requests messen weiterhin ihre tatsächliche
Differenz zum Zielbranch; die unveränderte 80-Prozent-Bedingung wird nicht abgeschaltet.

`vitest.config.ts` nimmt alle ausführbaren Dateien unter `apps` und `packages` ausdrücklich auf.
Vollständig unimportierte Produktionsdateien erscheinen deshalb mit 0 Prozent im LCOV-Nenner.
Abgerundete lokale Mindestwerte für Statements, Branches, Functions und Lines verhindern eine
Verschlechterung des Bestands; das SonarQube-Ziel für neuen Code bleibt davon getrennt bei 80 Prozent.
Grundmenge, Messwerte und Schwellen sind im
[`Coverage-Ratchet vom 11. August 2026`](coverage-ratchet-2026-08-11.md) festgehalten.

Die fachliche Prüfung des Bug-/Vulnerability-Bestands vom 11. August 2026 ist unter
[`sonarcloud-issue-triage-2026-08-11.md`](sonarcloud-issue-triage-2026-08-11.md) dokumentiert. Dort
sind auch die sechs einzeln bestätigten Scanner-Fehlalarme begründet. Ihre Ausschlüsse sind in
`sonar-project.properties` jeweils auf exakt eine Regel und eine Datei begrenzt; globale
Regelabschaltungen sind nicht zulässig.

## GitHub Actions

Die GitHub-CI in `.github/workflows/ci.yml` führt Basisprüfung/Coverage, Worker-Runtime,
V1-Kernintegration, Backup-Restore und Dokumentation als parallele Jobs aus. Der Sonar-Job folgt
erst nach erfolgreichem Basisjob, lädt dessen LCOV-Artefakt und führt dadurch keinen zweiten,
potenziell abweichenden Coverage-Lauf aus:

- bei Änderungen auf `main`,
- bei internen Pull Requests,
- nicht bei Pull Requests aus Forks oder von Dependabot, weil GitHub dort keine regulären
  Repository-Secrets bereitstellt.

Im GitHub-Repository muss ein Actions-Secret namens `SONAR_TOKEN` mit einem ausschließlich für die
Analyse berechtigten SonarQube-Cloud-Token eingerichtet sein. Fehlt das Secret bei einem vorgesehenen
Lauf, kann die offizielle, versionsgenau gepinnte SonarSource-Action keine Analyse übertragen. Vor der
Action erzeugt der Basisjob den LCOV-Bericht mit den lokalen Ratchets; der Scanner wartet
anschließend höchstens fünf Minuten auf das Quality Gate. Ein nicht bestandenes Gate lässt den
Sonar-Job fehlschlagen. Details zu Jobgrenzen und bewusst getrennten Langzeitabnahmen stehen im
[`CI-Qualitätsgate-Nachweis vom 11. August 2026`](ci-quality-gates-2026-08-11.md).

Ein Ausfall von SonarQube Cloud kann den Sonar-Job blockieren, aber weder
`npm run build` noch `npm run check`. Eine lokale Freigabe stützt sich weiterhin auf die
Repository-Prüfung; Historie, zentrale Issues und das Quality Gate stammen aus SonarQube Cloud.
