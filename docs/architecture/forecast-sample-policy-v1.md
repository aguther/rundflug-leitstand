# Messwertbehandlung der V1-Prognose

Die lernende Prognose verwendet ausschließlich Umläufe im Zustand `COMPLETED`, für die Aufruf und
Abschluss als Ist-Ereignisse gespeichert sind. Abgebrochene, zurückgenommene oder noch laufende
Umläufe gelangen damit nicht in die Messwertmenge.

Pro Produkt und – sofern verfügbar – Flugzeugtyp werden höchstens die zwölf jüngsten Werte gewichtet.
Nicht endliche, nicht positive oder mehr als dreifach über dem Referenzwert liegende Dauern werden
verworfen. Ab fünf plausiblen Werten entfernt eine robuste Median-/MAD-Regel zusätzlich einzelne
statistische Ausreißer. Die Toleranz ist mindestens die Hälfte des Referenzwertes, damit normale
operative Schwankungen nicht vorschnell verworfen werden.

Bei einer aktiven Unterbrechung, im Notfallmodus, bei inaktiver Ressourcengruppe oder ohne aktive
Kapazität wird nicht aus Messwerten fortgeschrieben. Die Prognose fällt auf den Planwert zurück und
kennzeichnet das Ergebnis als `UNCERTAIN`; öffentliche Ansichten zeigen dann keinen Countdown.

Korrekturen verändern das append-only Ereignisprotokoll nicht. Nur der daraus bestätigte aktuelle
Umlaufzustand entscheidet, ob eine Dauer als abgeschlossener Messwert berücksichtigt wird.
