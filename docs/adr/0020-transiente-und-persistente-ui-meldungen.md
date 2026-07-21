# ADR-0020: Transiente und persistente UI-Meldungen

- Status: Akzeptiert
- Datum: 2026-07-21
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: V17-UI-020, V17-UI-040

## Kontext

Aktionsbestätigungen wurden in mehreren Ansichten innerhalb des Dokumentflusses dargestellt und
blieben teilweise dauerhaft sichtbar. Gleichzeitig müssen Offline-, Notfall- und andere
betriebliche Zustände erkennbar bleiben, solange sie fachlich bestehen.

## Entscheidung

- Kurzlebige Rückmeldungen auf Benutzeraktionen werden über einen gemeinsamen Nachrichtenstapel
  rechts oben veröffentlicht. Erfolg und Information bleiben fünf Sekunden, Aktionsfehler zehn
  Sekunden sichtbar. Hover und Tastaturfokus pausieren die Frist; manuelles Schließen bleibt möglich.
- Offlinezustand, ein nicht bestätigter Verbindungsstand, Notfallmodus, Betriebsunterbrechung,
  Betriebshinweise und notwendige Einrichtungswarnungen sind persistente Zustandsmeldungen. Sie
  verschwinden erst bei Zustandsänderung oder nach bewusster manueller Schließung.
- Beide Meldungsarten verwenden denselben zugänglichen Overlay-Bereich und verändern den
  Dokumentfluss nicht. Fachliche Dialoge und Zustandsautomaten werden dadurch nicht verändert.

## Folgen

Ansichten veröffentlichen Aktionsmeldungen über einen gemeinsamen React-Kontext. Es entstehen keine
neuen Transportverträge, Abhängigkeiten, Datenbankfelder oder Auditereignisse.
