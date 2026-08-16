# ADR-0055: Dauerhafter Web-Asset-Spielraum und native SVG-Diagramme

- Status: Akzeptiert
- Datum: 2026-08-16
- Fortführung von: ADR-0048
- Betroffene Qualitätsziele: QS-21

## Kontext

ADR-0048 führte rollenbezogene Web-Einstiege, harte Assetbudgets, ein Zwei-Prozent-Ratchet und einen
begrenzten operativen PWA-Precache ein. Der gemessene Stand lag bei globaler CSS,
Flight-Line-CSS, größtem JavaScript-Chunk und Precache jedoch so nahe an den absoluten Grenzen, dass
kleine fachliche Erweiterungen die Budgets überschreiten konnten. Rollenfremde Styles lagen weiterhin
in globalen oder gemeinsam operativen Einstiegen. Zwei Zeitreihendiagramme zogen außerdem die große
Recharts-Laufzeit in Admin- und Analysepfade.

## Entscheidung

- Die absoluten Assetbudgets aus ADR-0048 bleiben unverändert. Das verbindliche Gate akzeptiert
  zusätzlich nur Werte, die höchstens 90 Prozent des jeweiligen Raw- und Gzip-Budgets belegen.
- `npm run web:assets:report` erzeugt vor jeder Messung einen frischen Produktionsbuild. Der Bericht
  nennt Budget, Istwert und verbleibende Reserve in Bytes und Prozent.
- Die commitgebundene Baseline liegt dauerhaft unter `scripts/data/web-asset-baseline.json`. Für jede
  der zehn Routen bleibt das Zwei-Prozent-Regressionsratchet für Raw und Gzip bestehen; eine neue
  Baseline muss beide Werte gegenüber ihrer Vorgängerin senken.
- Das Asset-Gate prüft den Inhalt des Service-Worker-Precache: Kasse, FIDS, Flight Line und Flight
  Director einschließlich ihrer statisch erreichbaren Entry-CSS müssen enthalten sein. Admin,
  Simulator, Vergleichs-Worker und lazy Verlaufsanalyse einschließlich Analytics-CSS bleiben
  online-only.
- Globale CSS enthält nur App-Shell, Tokens, universelle Hinweise und rollenübergreifende Regeln.
  Administration, Kasse, Flight Line, Flight Director und Verlaufsanalyse besitzen eigene
  Style-Grenzen. `operations-finish-v12.css` gehört ausschließlich zum Flight-Line-Entry.
- Ein interner, dependency-freier React-/SVG-Renderer übernimmt Achsen, Raster, lineare, monotone und
  Step-after-Pfade, Flächen, Referenzen, Punkte und Skalierung. Die fachlichen Diagramme liefern nur
  vorbereitete Daten und Darstellungsparameter. SVG-Zeichenflächen erzeugen keine Tabstopps.
- Recharts und der dafür direkt deklarierte `react-is`-Eintrag werden aus der Web-Laufzeit entfernt;
  es wird keine Ersatzabhängigkeit eingeführt.

## Konsequenzen

- Assetwachstum kann weder durch das Anheben der Hard Limits noch durch das Ausschöpfen der letzten
  zehn Prozent unbemerkt integriert werden.
- Rollen- und Online-Grenzen sind gleichzeitig Quelltext-, Bundle- und Precache-Grenzen und werden
  durch automatisierte Tests abgesichert.
- Die beiden SVG-Diagramme behalten Daten, Kurven, Tooltip, Zoom, Pan, Reset, Referenzlinien,
  Zeitzonenticks, zugängliche Namen und Reduced-Motion-Verhalten, ohne eine allgemeine Chart-Laufzeit
  auszuliefern.
- Änderungen am Renderer oder an Style-Grenzen benötigen Pure-/DOM-Tests, einen frischen
  Assetbericht und eine visuelle Browserabnahme der betroffenen Rollen.

## Alternativen

- Kleinere Recharts-Imports oder manuelles Vendor-Chunking hätten die Bibliothek weiterhin ausgeliefert
  und den größten Chunk beziehungsweise die Summe der Route nur verschoben.
- Höhere Hard Limits hätten die technische Schuld verdeckt, aber keinen dauerhaft nutzbaren Spielraum
  geschaffen.
- Ein globaler Finish-Layer hätte die bisherige Kaskade einfacher erscheinen lassen, Rollen aber erneut
  mit nicht erreichbaren Selektoren belastet.
