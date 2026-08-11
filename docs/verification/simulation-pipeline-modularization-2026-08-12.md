# Verifikationsnachweis: Modulare deterministische Simulationspipeline

- Datum: 2026-08-12
- Arbeitspaket: AP-13
- Entscheidung: [ADR-0042](../adr/0042-modulare-deterministische-simulationspipeline.md)

## Geprüfter Umfang

- gemeinsame Seed-, PRNG-, Dreiecksverteilungs-, Stichproben- und Zeitprimitive,
- Golden-Sequenzen für drei Seeds einschließlich Unicode-Schlüssel,
- unveränderte Legacy-, Operational- und Vergleichsbaselines,
- fachliche Phasen beider Simulationsengines,
- operative Topologie, produktbezogene Nachfrage, Pläne, wiederkehrende Regeln, Precall und Dispatch,
- Aufnahme von `engine.test.ts` in den regulären Coverage-/Sonar-Lauf,
- Größenratchets für Orchestratoren und extrahierte Module.

## Ergebnis

`engine.ts` wurde von 1.513 auf 214 Zeilen und `operational-engine.ts` von 1.490 auf 339 Zeilen
reduziert. Beide Dateien orchestrieren nur noch explizite fachliche Phasen. Der Seed-Stabilitätstest
belegt feste Hash- und PRNG-Sequenzen; die bestehenden 32 Simulator-Regressionsfälle bleiben grün.

Der vollständige Repository-Check einschließlich Lint, Ratchets, Typprüfung, 1.595 Tests, Web-/Worker-
Build, Analyse-/Skalierungsnachweisen, 18 V1-Integrationssuiten, Abnahmetag, Backup-Restore,
Dokumentation und Requirements-Verifikation lief auf der aktuellen `origin/main`-Basis erfolgreich.
Das arc42-PDF umfasst 41 Seiten; die geänderten Diagramm-, Entscheidungs- und Schuldenseiten wurden
visuell ohne abgeschnittene oder überlappende Inhalte abgenommen.

Der lokale Coverage-Lauf umfasste 300 Testdateien mit 1.585 erfolgreichen und 6 übersprungenen Tests.
Die operative Pipeline erreicht dabei 85,88 % Statements / 63,95 % Branches in
`operational-engine.ts`; ihre extrahierten Phasen liegen zwischen 80,00 % und 96,61 % Statements.
Repository-weit wurden 59,83 % Statements, 53,96 % Branches, 57,71 % Funktionen und 61,55 % Zeilen
erreicht.
