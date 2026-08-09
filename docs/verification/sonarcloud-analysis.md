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

Der instrumentierte Coverage-Lauf lässt ausschließlich den zeitabhängigen 300-Gruppen-Benchmark aus,
weil die V8-Instrumentierung dessen unveränderte Zwei-Sekunden-Grenze verfälscht. Der Benchmark bleibt
vollständig Bestandteil von `npm test`, `npm run build` und `npm run check`; alle übrigen Forecast-Tests
tragen weiterhin zum LCOV-Bericht bei.

```text
npm run sonar
```

Die Projektkennung, Organisation, Quellen, Testdateien und der LCOV-Pfad liegen nachvollziehbar in
`sonar-project.properties`. Die Abhängigkeiten `@sonar/scan` und `@vitest/coverage-v8` dienen
ausschließlich dem optionalen Analyselauf und verändern den normalen Build nicht.

## GitHub Actions

Der von SonarQube Cloud vorgegebene Workflow `.github/workflows/build.yml` läuft getrennt von der
lokalen und serverunabhängigen
CI-Prüfung:

- bei Änderungen auf `main`,
- bei internen Pull Requests,
- nicht bei Pull Requests aus Forks oder von Dependabot, weil GitHub dort keine regulären
  Repository-Secrets bereitstellt.

Im GitHub-Repository muss ein Actions-Secret namens `SONAR_TOKEN` mit einem ausschließlich für die
Analyse berechtigten SonarQube-Cloud-Token eingerichtet sein. Fehlt das Secret bei einem vorgesehenen
Lauf, kann die offizielle, versionsgenau gepinnte SonarSource-Action keine Analyse übertragen. Vor der
Action installiert der Job die festgelegte Node-/npm-Toolchain, erzeugt den LCOV-Bericht und wartet
anschließend höchstens fünf Minuten auf das Quality Gate. Ein nicht bestandenes Gate lässt den
separaten Job fehlschlagen.

Ein Ausfall von SonarQube Cloud blockiert dadurch den Sonar-Job, aber weder `npm run build` noch
`npm run check`. Eine lokale Freigabe stützt sich weiterhin auf die Repository-Prüfung; Historie,
zentrale Issues und das Quality Gate stammen aus SonarQube Cloud.
