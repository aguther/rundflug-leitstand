# Technische Schulden

Dieses Verzeichnis ist das aktuelle Register bestätigter technischer Schulden. Historische
Releaseberichte und bereits erledigte Arbeitspakete werden nicht fortgeschrieben; ihr Verlauf bleibt
über Git, ADRs und Verifikationsnachweise nachvollziehbar.

Ein Eintrag bleibt nur solange hier, wie der Befund am aktuellen Implementierungsstand nachweisbar
ist. Jede Schuld nennt Wirkung, sichere Abbaugrenzen und ein prüfbares Abschlusskriterium.

Die [Neubewertung vom 16. August 2026](assessment-2026-08-16.md) ordnet außerdem die Befunde der
drei entfernten historischen Schuldenberichte nachvollziehbar als fortgeltend, behoben oder als
bewusste Architekturentscheidung ein.

| Thema | Priorität | Aktueller Befund |
| --- | --- | --- |
| [Mutationstest-Aussagekraft](mutation-test-effectiveness.md) | Mittel | fokussiertes Gate ist etabliert, einzelne Module und überlebende Mutanten bleiben schwach |
| [Worker-Orchestrierung](worker-orchestration-complexity.md) | Mittel | Stammdaten- und Operationspfade bündeln weiterhin viele Entscheidungen |

Bewusste Architekturentscheidungen wie die Online-Pflicht der Administration oder der inkompatible
V1.12-D1-Baseline-Neuaufbau sind keine technischen Schulden. Sie werden als Randbedingungen,
Betriebsrisiken und ADRs geführt.
