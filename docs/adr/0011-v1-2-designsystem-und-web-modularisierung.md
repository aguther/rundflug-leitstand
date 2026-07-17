# ADR-0011: V1.2-Designsystem und modulare Webanwendung

- Status: Akzeptiert
- Datum: 2026-07-17
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: Q-UX-010, Q-UX-020, Q-UX-040, Q-UX-070, Q-UX-090, Q-UX-100 und
  Q-WAR-060

## Kontext

Die Webanwendung mischt mehrere visuelle Generationen, verwendet auf Desktop zu viel Platz und
bündelt einen großen Teil der Oberfläche und Zustandslogik in `App.tsx` sowie einer zentralen
CSS-Datei. Supervisor und mehrere Helfer benötigen zugleich unterschiedliche Flight-Line-Abläufe,
die auf demselben Gerätetyp verfügbar sein können.

## Entscheidung

- Die am 17. Juli 2026 bestätigten Referenzbilder in
  `docs/ui/operations-v2-multi-surface-concept.md` sind die ausschließliche visuelle Quelle für
  V1.2. Ältere Konzepte sind historisch.
- Ein gemeinsames Designsystem definiert semantische Farb-, Typografie-, Abstands-, Radius-,
  Höhen-, Fokus- und Bewegungstokens für Light und Dark Mode.
- Interne Desktop-Oberflächen verwenden kompakte Tabellen und Werkzeuge. Formulare öffnen als
  Drawer, Sheet oder Dialog erst nach einer ausdrücklichen Aktion.
- Öffentliche FIDS-Oberflächen behalten bewusst große, aus Distanz lesbare Typografie.
- Supervisor und Assist sind getrennte Routen und Berechtigungen. Ein Supervisor kann auf dem iPad
  die vollständige, responsiv angeordnete Supervisor-Oberfläche oder Assist verwenden. Ein
  Assist-Konto erhält ausschließlich den vereinfachten Ablauf.
- Auf Telefonen ist Assist einspaltig; auf Tablets zweispaltig. Die Auswahl erfolgt über Rolle und
  bewussten Modus, nicht automatisch nur über einen Media Query.
- `App.tsx` wird auf Routing und Provider-Komposition reduziert. Designsystem, Authentifizierung,
  Administration, Kasse, Flight Line, FIDS und Ticketstatus werden eigenständige Featuremodule.
- Visuelle Abnahme erfolgt je Oberfläche in Light und Dark sowie bei den freigegebenen Desktop-,
  Tablet-, Telefon- und 16:9-FIDS-Viewports.

## Folgen

Die Migration erfolgt vertikal: Designsystem und App-Shell zuerst, danach Authentifizierung und
anschließend Oberfläche für Oberfläche. Fachliche Zustandsübergänge verbleiben in Domain und Worker.
Automatisierte UI-Verträge werden durch Browser- und Screenshotabnahmen ergänzt.

