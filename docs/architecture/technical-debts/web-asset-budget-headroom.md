# Begrenzter Spielraum der Web-Assets

- **Status:** offen
- **Priorität:** mittel
- **Evidenz:** Die manifestbasierten Budgets erlauben pro Route höchstens zwei Prozent Regression. Der
  vollständige Nachweis vom 16. August 2026 misst 93,87 KiB globale CSS, 72,41 KiB
  Flight-Line-CSS, 313,48 KiB für den größten JavaScript-Chunk und 1.289,35 KiB PWA-Precache; mehrere
  Werte besitzen weiterhin nur begrenzten Abstand zu ihren harten Grenzen.

## Wirkung

Neue operative Funktionen können ein Assetbudget überschreiten oder unnötige Rollenmodule in den
mobilen Startpfad ziehen. Eine bloße Anhebung der Grenzen würde die erreichte Trennung von
Flight Line, Flight Director, Administration und Analyseflächen wieder aufweichen.

## Sicherer Abbau

Jede relevante Webänderung vergleicht `npm run web:assets:report` vor und nach dem Schnitt. Schwere
Analyse-, Simulator- und Administrationsmodule bleiben lazy, ihre großen Online-only-Chunks bleiben
außerhalb des PWA-Precache und stylespezifische Regeln werden nicht in globale CSS-Schichten
zurückverschoben.

## Abschlusskriterium

Alle Rollenrouten besitzen dauerhaft einen dokumentierten Reserveabstand zu den harten Budgets, ohne
das freigegebene Offlineverhalten oder die UI-Geometrie zu verändern; Baselines und Ratchets werden
anschließend auf den niedrigeren Stand abgesenkt.
