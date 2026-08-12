# SonarQube-Maintainability-Triage vom 12. August 2026

## Messbasis

Die Bestandsaufnahme verwendet den SonarQube-MCP-Server für Projekt
`aguther_rundflug-leitstand`, Branch `main`, Analyse vom 12. August 2026 um 10:46 UTC.
Die Abfrage der offenen und bestätigten Issues ergab keine Blocker, 147 High- und 466
Medium-Funde. Bugs, Vulnerabilities und ungeprüfte Security Hotspots standen jeweils bei null.

Die Gesamt-Coverage betrug 59,8 Prozent, davon 63,6 Prozent Line- und 55,2 Prozent
Branch-Coverage. 6.594 von 18.134 ausführbaren Zeilen und 6.574 von 14.658 Bedingungen waren
nicht abgedeckt. Die New-Code-Coverage von 82,5 Prozent erfüllte das Quality Gate, ersetzt aber
nicht die Arbeit am produktiven Bestand.

## High-Triage

| Regelgruppe | Anzahl | Bewertung | Behandlung |
| --- | ---: | --- | --- |
| Cognitive Complexity (`S3776`) | 90 | berechtigte Wartbarkeitsschuld | verhaltenswahrend nach Domain, Worker, UI und Werkzeugen aufteilen; bestehende Tests zuerst als Regression sichern |
| SQLite als PL/SQL: Literale (`plsql:S1192`) | 39 | Scanner-Fehlalarm | regel- und dateischarf ausnehmen; SQLite-Migrationen und deklarative Seeds besitzen keine PL/SQL-Konstanten |
| SQLite als PL/SQL: `CREATE OR REPLACE` | 10 | Scanner-Fehlalarm | regel- und dateischarf ausnehmen; SQLite unterstützt `CREATE OR REPLACE TRIGGER` nicht |
| Python-Literale (`python:S1192`) | 4 | berechtigter kleiner Befund | sprechende Konstanten verwenden |
| unnötiger `void`-Operator (`typescript:S3735`) | 2 | berechtigter kleiner Befund | synchrone Handler direkt aufrufen beziehungsweise durchreichen |
| Bitoperation und Dataset (`typescript:S7767`, `S7761`) | 2 | berechtigte kleine Befunde | 32-Bit-Zustand explizit unsigned normalisieren und `dataset` verwenden |

Historische Migrationen werden nicht umgeschrieben. Die 49 PL/SQL-Fehlalarme werden auf die
jeweilige Regel und exakt eine unveränderliche SQL-Datei begrenzt. Betroffen sind sechs Dateien
für `CreateOrReplaceCheck`, zwölf Migrationen und zwei synthetische Seeds für `S1192`. Andere
Regeln in diesen Dateien und dieselben Regeln in neuen SQL-Dateien bleiben aktiv.

## Medium-Cluster

Die 466 Medium-Funde konzentrieren sich auf wenige Ursachen: 273 verschachtelte Ternaries in
TypeScript/JavaScript, 81 CSS-Funde, 42 semantische React-/Accessibility-Funde und kleinere
Gruppen zu Fehlerbehandlung, veralteten APIs, ungenutzten Zuweisungen und identischen Funktionen.
Sie werden nach den High-Funden ursachenbezogen bearbeitet. Accessibility-Funde werden nicht
mechanisch umgeschrieben, sondern gegen die tatsächliche Interaktion und Browsersemantik geprüft.

## Coverage-Priorisierung

Coverage-Arbeit folgt dem fachlichen Risiko und dem absoluten ungedeckten Umfang. Vorrang haben
der Event Coordinator und Worker-Command-Services, Forecast-/Dispatch-Domainlogik sowie die
operativen Flight-Line- und Kassenabläufe. Große reine UI-Komponenten werden über beobachtbares
Verhalten getestet; Framework-Bootstrap oder deklarative Verdrahtung wird nicht allein für eine
Kennzahl künstlich ausgeführt. Zusätzliche Coverage-Exclusions sind aus dieser Triage nicht
abgeleitet.
