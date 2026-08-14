# KI-Fallstudie zum Rundflug-Leitstand

Dieser Ordner bewahrt die Präsentation zur Entstehung des Rundflug-Leitstands und das dafür verwendete, nicht bereits im Repository vorhandene Bildmaterial auf. Der Stand der Präsentation ist der 14. August 2026.

## Inhalt

- `rundflug-leitstand-ki-fallstudie.pptx`: 35 vollständig neu gestaltete Folien. Die Dramaturgie führt vom realen Produkt und Gast-Erlebnis über Entstehung, UX-Freigaben, Architektur, ADRs und parallele KI-Arbeit bis zu Teststrategie, SonarQube-Bereinigung, Aufwand, Frustmomenten und Grenzen.
- `assets/live/`: reale Screenshots der aktuellen Dark-Theme-Oberflächen, der Gast-PWA und der iOS-Push-Nachrichten.
- `assets/simulator/`: Screenshots des Simulators und seiner Auswertungen mit synthetischen Daten.
- `assets/sonarqube/`: SonarQube-Nachweise zum Weg von 778 bewerteten Findings zu null offenen Issues und einem bestandenen Quality Gate.

## Bewusst nicht dupliziert

Die Präsentation bindet vorhandene Quellen ein, legt sie aber nicht nochmals als eigenständige Dateien ab:

- Architektur- und Laufzeitdiagramme stammen aus [`docs/arc42/`](../../arc42/). Die Mermaid-Quellen bleiben dort kanonisch.
- Architekturentscheidungen stammen aus [`docs/adr/`](../../adr/).
- Der Engineering- und Integrationsprozess basiert auf der [`AGENTS.md`](../../../AGENTS.md).
- Historische UX/UI-Renderings stammen aus der Git-Historie. Sie sind in der Präsentation eingebettet, werden jedoch nicht zusätzlich als Bilddateien abgelegt.
- Zwei identische Screenshot-Paare aus dem gelieferten Material wurden per SHA-256 erkannt und jeweils nur einmal übernommen.

## Einordnung

Die Screenshots dokumentieren einen Demonstrationsstand mit synthetischen Veranstaltungs-, Ticket- und Betriebsdaten. Die Präsentation selbst ist ein kuratierter Zeitstand; Anforderungen, ADRs, arc42 und Tests bleiben die fachlichen und technischen Quellen der Wahrheit.
