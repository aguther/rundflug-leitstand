# ADR-0033: Skalierbare Kurz- und Langzeitprognose

## Status

Freigegeben

## Kontext

ADR-0032 begrenzt die kombinatorische Dispatch-Optimierung bewusst auf die nächsten operativ
relevanten Batches. Diese Begrenzung ist für eine stabile Empfehlung an Flight Line und Flight
Director notwendig, darf aber nicht die Prognose für weiter hinten wartende Fluggruppen beenden.
Die bisherige Behandlung von `NOT_IN_NEAR_DISPATCH_BATCH` entfernte deren Zeitfenster und machte
dadurch Langzeitprognose, öffentliche Statusanzeige und Verkaufskapazität unvollständig.

Eine vollständige kombinatorische Suche über bis zu 300 offene Gruppen wäre weder erforderlich noch
angemessen. Für entfernte Gruppen genügt eine deterministische, konservative Projektion. Gleichzeitig
müssen gemeinsame Ressourcengruppen-Queues, ganze Buchungsgruppen, Produkt- und Gate-Reinheit,
Flugzeug-/Pilotenspuren, geplante und wiederkehrende Einschränkungen sowie unbekannte Rückkehrzeiten
erhalten bleiben.

## Entscheidung

Die Prognose verwendet zwei klar getrennte Phasen:

1. Der begrenzte Dispatch-Planer erzeugt weiterhin ausschließlich die nahe, versionierte Empfehlung.
   Seine Batches können menschlich bestätigt werden; die Prognose selbst bindet kein Flugzeug und
   keinen Pilotencode.
2. Alle danach verbleibenden prognostizierbaren Gruppen werden linear und deterministisch auf die
   fortgeschriebenen Verfügbarkeitsspuren gelegt. Die Reihenfolge verwendet dieselbe
   ressourcengruppenweite Prioritätsordnung wie der Dispatch-Planer. Pro Schritt wird die früheste
   kompatible Spur gewählt und mit vollständigen Gruppen desselben Produkts und Gates gefüllt. Für
   den Langzeitschwanz gibt es keine Beam-Suche.

`MISSING` und `CLARIFICATION` erhalten keine Kapazitätsreservierung. Ressourcen mit unbekannter
Rückkehrzeit werden ausgeschlossen und als eigener Grund ausgewiesen. Prognosen laufen über das
konfigurierte Betriebsende hinaus weiter. Intern werden `extendsBeyondOperationsEnd` und
`overtimeMinutes` ausgewiesen; öffentlich erscheint dafür der Zustand
`AFTER_OPERATIONS_END` mit dem Text „Voraussichtlich heute nicht mehr“.

Der öffentliche Vertrag unterscheidet `DISPATCH_WINDOW`, `LONG_RANGE_WINDOW`,
`AFTER_OPERATIONS_END` und `UNAVAILABLE`. Sichere Gründe für `UNAVAILABLE` sind unter anderem offene
Rückkehrzeit, fehlende passende Kapazität und Statusklärung. Globale Unterbrechung und Notfallmodus
unterdrücken weiterhin scheinpräzise Zeitangaben. Geplante Pausen mit bekanntem Zeitraum bleiben
dagegen Bestandteil der berechneten Fenster. Die frühere pauschale Unterdrückung von Fenstern über
60 Minuten entfällt.

Die Verkaufskapazität wird nach der vollständigen gemeinsamen Queue als marginales Produktszenario
bis zum Betriebsende simuliert. Zusätzliche Sitze zählen nur, wenn das konservative obere
Abschlussende vor oder auf dem Betriebsende liegt. Produkt-/Flugzeug-Dauern, geplante und
wiederkehrende Einschränkungen sowie die gemeinsame Ressourcengruppenbelegung wirken auch in dieser
Simulation. Geringe Qualität führt weiterhin zu manueller Prüfung; eine Kapazität nach Betriebsende
ist keine Verkaufskapazität.

Produktion und Simulator verwenden dieselben Domainfunktionen für Zeitlinien und öffentliche
Zustandsabbildung. Der Simulator legt auch bei nicht verfügbarer Prognose einen aktuellen Snapshot
ab, damit kein älteres Fenster sichtbar bleibt.

Die vorhandenen Prognose-, Dispatch- und Snapshot-Spalten reichen für Persistenz und interne
Diagnostik aus. Diese Entscheidung benötigt keine D1-Migration.

## Folgen

- Die kombinatorische Laufzeit bleibt durch die nahe Dispatch-Planung begrenzt; der vollständige
  Schwanz wächst im Wesentlichen linear mit Gruppen und Spuren.
- Nahe und entfernte Fenster können sich bei einer Neuberechnung ändern. Entfernte Fenster besitzen
  mindestens Qualität `CHANGING`, sofern sie nicht bereits `UNCERTAIN` sind.
- Öffentliche Clients müssen Zustand und Grund auswerten und dürfen aus fehlenden Zeitstempeln keine
  eigene Semantik ableiten.
- Kasse, FIDS, öffentlicher Ticketstatus und Simulator erhalten denselben fachlichen Stand.
- Die Kapazitätsanzeige ist vorsichtiger und kann bei unvollständiger Ressourcenklarheit keine
  Verkaufsempfehlung geben.

## Nachweis

Die Domain-Tests decken Mehrprodukt-/Mehrspur-Queues, geplante und wiederkehrende Pausen,
unbekannte Rückkehrzeiten, Anwesenheitsklärung, Betriebsschluss und 300 Gruppen unter zwei Sekunden
ab. Vertrags-, Worker-, Simulator- und UI-Tests prüfen die identische öffentliche Abbildung und die
vollständigen FIDS-Fenster.

Refs: F-SLT-080, F-SLT-090, F-SLT-110, F-SLT-120, F-FLT-090, F-PRG-020, F-PRG-030,
F-PRG-070, F-PRG-080, F-PRG-090, F-PRG-100, F-PRG-110, F-KAP-010, F-KAP-050,
F-KAP-060, F-MON-010, F-BEN-010, D-045, D-050, D-055, Q-ZUV-010, Q-PER-030
