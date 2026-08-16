# ADR-0042: Modulare deterministische Simulationspipeline

- Status: Teilweise ersetzt durch ADR-0054
- Datum: 2026-08-12
- Entscheidung: Technische Modularisierung ohne Änderung des Simulationsvertrags
- Betroffene Anforderungen: Q-WAR-040, Q-WAR-060, Q-PER-010 und Q-TST-010

## Kontext

Der lokale Prognosesimulator besitzt eine synthetische Legacy-Engine und eine aus importierten
Stammdaten aufgebaute operative Engine. Beide Engines bündelten Nachfrageerzeugung, Ereignisfortschritt,
Voraufruf, Dispatch, Prognose-Snapshots und Kennzahlen in jeweils einem großen Ablauf. Gleichzeitig
existierten Zufallszahlengenerator, Seed-Hash, Dreiecksverteilung und Zeitrundung doppelt. Änderungen
an der Reihenfolge eines Zufallsaufrufs konnten deshalb unbemerkt reproduzierbare Baselines verändern.

Die Tests der operativen Engine lagen zudem in einer Datei, die der Sonar-Coverage-Lauf vollständig
ausschloss. Die fachlichen Tests liefen im normalen Testlauf, belegten aber keine Coverage der
produktiven operativen Pipeline.

## Entscheidung

- Beide Engines bleiben getrennte Szenarioadapter, werden aber in dieselben fachlichen Phasen
  gegliedert: Szenarioaufbau, Lifecycle, Forecast, Precall, Dispatch, Snapshot und gemeinsame Metriken.
- `engine.ts` und `operational-engine.ts` orchestrieren nur noch diese Phasen. Seiteneffekte bleiben
  innerhalb eines 30-Sekunden-Ticks in derselben Reihenfolge; insbesondere erfolgen Persistenz oder
  externe Kommunikation weiterhin nicht, weil die Simulation vollständig im Browser bleibt.
- PRNG, Seed-Hash, deterministische Stichprobe, Dreiecksverteilung, Zeitaddition und Tick-Rundung liegen
  einmalig in `simulation-primitives.ts`. Die Seed-Ausgabe ist ein Kompatibilitätsvertrag und wird mit
  Golden-Sequenzen für mehrere Seeds einschließlich Unicode-Schlüsseln abgesichert.
- Die bisherige öffentliche `sampleTriangular`-Ausgabe von `engine.ts` bleibt als kompatibler Re-Export
  erhalten.
- `engine.test.ts` wird nicht mehr aus `test:coverage` ausgeschlossen. Damit laufen die operativen
  Topologie-, Plan-, Dispatch-, Incident-, Regel- und Determinismusfälle im Sonar-Coverage-Lauf.
- Größenratchets schützen den verkleinerten Orchestrator und alle extrahierten Phasenmodule gegen eine
  erneute Zusammenführung.

## Folgen und Wiederherstellung

Seed und Eingabekonfiguration erzeugen weiterhin bytegleich dieselbe Simulation. Die Engines können
je Phase getestet und geändert werden, während gemeinsame deterministische Regeln nicht mehr
auseinanderlaufen. Der Coverage-Lauf dauert länger, bildet dafür aber den tatsächlich produktiven
operativen Simulationspfad ab.

Es gibt keine Datenbank-, Contract- oder Deploymentmigration. Ein Rollback besteht aus der
Wiederbereitstellung der vorherigen PWA; gespeicherte Simulationsdaten oder Serverzustände müssen nicht
repariert werden.
