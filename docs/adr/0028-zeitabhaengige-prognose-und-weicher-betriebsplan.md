# ADR-0028: Zeitabhängige Prognose und weicher Betriebsplan

## Status

Angenommen – Release 1.10.0

## Kontext

Die bisherige Prognose verdichtete die Verfügbarkeit einer Ressourcengruppe auf die Zahl der
gerade aktiven Flugzeuge. Eine vorübergehende Pause oder Betankung sah dadurch wie ein dauerhafter
Kapazitätsverlust aus. Bei jeder Rückkehr wurde die gesamte Queue neu auf weniger oder mehr
parallele Ressourcen verteilt. Das erzeugte große, betrieblich nicht erklärbare Sprünge und
zeitweise öffentliche Fenster von mehr als zwei Stunden.

Vor dem Flugbetrieb fehlte außerdem ein belastbarer zeitlicher Anker. Der Simulator konnte zwar
Pausen und Unterbrechungen erzeugen, der reale Betrieb aber keinen unverbindlichen Tagesplan für
Pausen, Tanken, Flugshows, Wetterfenster oder andere absehbare Einschränkungen mitteilen. Exakte
Uhrzeiten wären dafür eine falsche Verbindlichkeit: Im Rundflugbetrieb beginnen solche Maßnahmen
häufig ungefähr in einem Zeitfenster oder erst nach einem bestimmten Umlauf.

## Entscheidung

Die Prognose verwendet je Ressourcengruppe gekoppelte Verfügbarkeitsbahnen aus genau einem
Flugzeug und einem anonymen Pilotencode. Jede Bahn besitzt einen frühesten, erwarteten und
spätesten Verfügbarkeitszeitpunkt. Laufende Umläufe, bestätigte Pausen, Tanken und
Unterbrechungen verschieben nur die betroffenen Bahnen. Offene Fluggruppen werden auf die jeweils
früheste erwartete Bahn disponiert; die Bahnidentität bleibt innerhalb einer Neuberechnung
erhalten.

Unsicherheit wird aus den Abweichungen der gekoppelten Bahnen aggregiert. Früheste Werte aller
Ressourcen und späteste Werte aller Ressourcen werden nicht unabhängig miteinander kombiniert,
weil dies künstlich große Intervalle erzeugen würde. Ein optionaler geplanter Betriebsbeginn
ankert die Prognose vor dem ersten Ist-Ereignis.

Der Flight Director kann weiche betriebliche Einschränkungen mit folgenden Angaben planen:

- Geltungsbereich Veranstaltung, Ressourcengruppe, Flugzeug oder anonymer Pilotencode,
- Art Pause, Tanken, Flugshow, Wetter, Technik oder Sonstiges,
- ungefähres Startfenster oder Beginn nach einem ausgewählten aktuellen Umlauf,
- minimale, typische und maximale Dauer,
- interner Grund und optionaler neutraler öffentlicher Hinweis.

Ein Plan ist zunächst `PLANNED` und wird nach Ablauf seines spätesten Startzeitpunkts lediglich als
`DUE` abgeleitet. Er verändert niemals selbst einen operativen Zustand. Start und Ende werden
durch Menschen über die vorhandenen Zustandskommandos bestätigt; erst dann wechselt der Plan zu
`ACTIVE` beziehungsweise `CLEARED` und wird mit der tatsächlichen Blockierung beziehungsweise
Pilotencode-Pause verknüpft.
Bearbeitung, Absage, Aktivierung und Aufhebung bleiben versioniert, idempotent und auditiert.

Ein Startfenster ist keine zugesagte Uhrzeit. Ein Ende ist eine unsichere erwartete Verfügbarkeit;
die Ressource wird erst nach bestätigter Rückkehr tatsächlich verfügbar. Fehlt ein erwarteter
Rückkehrzeitpunkt, wird die Ressource nicht als künftige Kapazität vorausgesetzt.

Interne Oberflächen behalten konkrete Prognosepunkte und Unsicherheitsintervalle. Öffentliche
Zeitfenster von mehr als 60 Minuten werden nicht als scheinpräzise Spanne ausgegeben, sondern als
`Wird aktualisiert`. Notfallmodus und aktive globale Unterbrechung bleiben harte unsichere
Zustände.

Produktion und Simulator verwenden denselben reinen Domänenalgorithmus. Der Simulator führt das
bisherige skalare Kapazitätsmodell als A/B-Baseline weiter und vergleicht zusätzlich
Prognosefehler, Abdeckung, mittlere und maximale Sprünge, Sprünge über 15 und 30 Minuten,
maximale Fensterbreite, Durchsatz, Überziehung und Flugzeugauslastung. Die Optimierung des
Simulators ist damit kein Selbstzweck, sondern muss bessere Entscheidungen im realen Betrieb
unterstützen.

## Folgen

- Geplante Einschränkungen verbessern die Vorausschau, ohne operative Freigaben vorwegzunehmen.
- Ungeplante Ereignisse werden weiterhin sofort verarbeitet; fehlende Rückkehrinformationen
  führen bewusst zu größerer Unsicherheit statt zu erfundener Kapazität.
- Plandaten werden in portablen Backups, Veranstaltungslöschung und Werksreset berücksichtigt.
- Der Tagesplan ist eine Entscheidungshilfe und weder Dienstplan noch luftrechtliche oder
  sicherheitsbezogene Freigabe.
- Die Entscheidung konkretisiert insbesondere `F-FLT-090`, `F-PRG-030`, `F-PRG-060`,
  `F-PRG-080`, `F-PRG-090`, `F-PRG-110`, `F-PRG-130`, `F-WET-040`, `D-065` und
  `Q-WAR-050`.
