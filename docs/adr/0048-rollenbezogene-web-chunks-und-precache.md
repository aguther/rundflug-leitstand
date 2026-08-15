# ADR-0048: Rollenbezogene Web-Chunks und begrenzter PWA-Precache

## Status

Angenommen am 15. August 2026.

## Kontext

Die Rollenansichten wurden bereits mit `React.lazy` geladen. Kasse und Flight Line enthielten jedoch
weiterhin die vollständige Orchestrierung in ihren Route-Dateien, Flight Line und Flight Director
teilten trotz verschiedener Oberflächen denselben CSS-Einstieg und ein historischer Flight-Line-Layer
lag zusätzlich in der globalen CSS-Datei. Dadurch waren die Grenzen im Quelltext und in den erzeugten
Assets unnötig breit. Der PWA-Precache enthielt außerdem den großen Administrations-Entry, obwohl
administrative Aktionen stets eine bestätigte Backend-Verbindung benötigen.

## Entscheidung

- Rollenrouten sind dünne Shells. Sie laden den zugehörigen Workspace und ausschließlich die für die
  Route benötigten Styles.
- Flight Line und Flight Director erhalten getrennte lazy Route-Einstiege. Beide verwenden dieselbe
  bestehende Workspace-Orchestrierung; Darstellung und fachliches Verhalten werden dadurch nicht
  geändert.
- Der historische Flight-Line-Layer wird ohne Gestaltungsänderung aus der globalen CSS-Datei in eine
  routenspezifische Grundlage verschoben. Flight Line lädt zusätzlich nur Basis-, gemeinsame,
  responsive und Assist-Styles; reine Supervisor-Styles bleiben dem Flight Director vorbehalten.
- Vite minifiziert CSS explizit mit Lightning CSS. Harte Assetbudgets und ein manifestbasiertes
  Route-Ratchet erlauben höchstens zwei Prozent Regression gegenüber dem gemessenen Stand.
- Der Administrations-Entry bleibt lazy und wird nicht vorab im Service Worker gespeichert. Die
  Administration benötigt beim ersten Öffnen eine Netzverbindung. Operative Kassen-, Flight-Line-,
  Flight-Director- und FIDS-Assets bleiben Bestandteil des Precache.
- Die noch großen Workspace-Orchestratoren werden als technische Schuld mit fallenden
  Größenratchets geführt. Neue extrahierte Komponenten und Hooks sollen höchstens 300 Zeilen besitzen;
  Fachregeln dürfen zur Erreichung dieses Ziels nicht in Präsentationscode wandern.

## Konsequenzen

- Ein iPhone an der Flight Line lädt keine Flight-Director-Styles mehr; der Flight Director lädt
  umgekehrt keine Assist-spezifischen Styles.
- Die freigegebene UI-Geometrie und alle öffentlichen JSON-Verträge bleiben unverändert.
- Ein bereits geladener Administrationsbereich kann den normalen Browsercache verwenden, ist aber
  kein zugesicherter Offline-Einstieg. Das ist konsistent mit der bestehenden Sperre sämtlicher
  administrativer Schreibaktionen ohne Serverbestätigung.
- Die Budgets werden durch `npm run web:assets:verify` und die Modulgrenzen durch
  `npm run refactor:guardrails` geprüft.

## Alternativen

- Ein gemeinsamer Flight-Line-/Flight-Director-Entry hätte weniger Dateien erzeugt, aber beide Geräte
  weiterhin mit nicht benötigten Styles belastet.
- Das Vorhalten der Administration im Precache hätte den Offline-Einstieg ermöglicht, obwohl keine
  administrative Aktion offline bestätigt werden kann, und das vereinbarte Precache-Budget verletzt.
