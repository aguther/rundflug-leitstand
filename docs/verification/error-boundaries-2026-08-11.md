# Nachweis der Web-Fehlergrenzen vom 11. August 2026

## Ziel und freigegebenes Konzept

AP-02 ergänzt einen neutralen Wiederherstellungspfad für unerwartete React-Renderfehler. Das
freigegebene Konzept verwendet die vorhandenen Design-Tokens, eine mittig angeordnete Meldung, eine
fokussierte Überschrift und genau eine Primäraktion „Neu laden“. Technische Ausnahmen, Stacktraces,
Tokens oder andere sensitive Details dürfen nicht im sichtbaren Fallback erscheinen.

Die globale Fehlergrenze umschließt die Provider-Initialisierung in `apps/web/src/main.tsx`. Die
routenbezogene Fehlergrenze umschließt den jeweiligen lazy geladenen Arbeitsbereich in
`apps/web/src/FeatureRouter.tsx` und wird bei einem Routenwechsel zurückgesetzt. Damit bleibt ein
Fehler auf einen Arbeitsbereich begrenzt, während Provider- und Initialisierungsfehler weiterhin
abgefangen werden.

## Automatisierter Nachweis

`apps/web/src/app/AppErrorBoundary.dom.test.tsx` prüft:

- neutrale Texte ohne den synthetischen sensitiven Fehlerinhalt,
- Fokus auf der Überschrift,
- exakt einen Aufruf der Neu-laden-Aktion,
- Fehler innerhalb eines Provider-ähnlichen Wrappers,
- den routenbezogenen Fallback und dessen Wiederherstellung nach geändertem Reset-Schlüssel.

`npm run test:browser:error-boundaries` startet eine isolierte Vite-Fixture und prüft beide
Fehlergrenzen in vier Kombinationen:

| Fehlergrenze | Farbschema | Viewport |
|---|---|---|
| global | hell | 1366 × 768 |
| Route | dunkel | 1366 × 768 |
| global | dunkel | 430 × 932 |
| Route | hell | 430 × 932 |

Der Browsernachweis prüft zusätzlich mindestens 44 Pixel hohe Primäraktion, fehlenden horizontalen
Überlauf, kein sichtbares Vite-Fehleroverlay und die erfolgreiche Wiederherstellung nach „Neu laden“.
Die Test-Fixture verwendet ausschließlich synthetische Daten.

## Ausgeführte Prüfungen

Am 11. August 2026 wurden erfolgreich ausgeführt:

- `npm run test -- --run apps/web/src/app/AppErrorBoundary.dom.test.tsx`: 1 Datei, 4 Tests;
- `npm run test:browser:error-boundaries`: 4 Browser-/Viewport-Kombinationen;
- isolierter Coverage-Nachweis für `AppErrorBoundary.tsx`: 93,75 % Statements, 87,5 % Branches,
  100 % Funktionen und 93,33 % Zeilen;
- `npm run typecheck`.

Die vollständigen Repository-, Dokumentations- und Build-Prüfungen werden gemeinsam mit dem
Integrationsstand von AP-02 ausgeführt.
