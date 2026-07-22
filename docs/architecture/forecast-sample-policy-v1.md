# Messwertbehandlung der V1-Prognose

Die lernende Prognose verwendet ausschließlich Umläufe im Zustand `COMPLETED`, für die Aufruf und
Abschluss als Ist-Ereignisse gespeichert sind. Abgebrochene, zurückgenommene oder noch laufende
Umläufe gelangen damit nicht in die Messwertmenge.

Messwerte des aktuellen Veranstaltungstags haben Vorrang. Frühere Vergleichswerte dienen nur dem
Kaltstart und werden verdrängt, sobald für das aktuelle, üblicherweise eintägige Event bestätigte
Tageswerte vorliegen. Pro Produkt und – sofern verfügbar – Flugzeugtyp werden höchstens die zwölf
jüngsten Werte gewichtet.

Nicht endliche, nicht positive oder mehr als das 1,75-Fache des Referenzwerts betragende Dauern werden
verworfen. Dadurch werden Serien außergewöhnlicher Verzögerungen durch Wetter, Flugshow oder andere
Sperrzeiten nicht als neue Normaldauer gelernt. Ab fünf plausiblen Werten entfernt eine robuste
Median-/MAD-Regel zusätzlich einzelne
statistische Ausreißer. Die Toleranz ist mindestens die Hälfte des Referenzwertes, damit normale
operative Schwankungen nicht vorschnell verworfen werden.

Umläufe, deren Zeitlinie eine bestätigte Veranstaltungsunterbrechung oder einen Notfall überlappt,
werden bereits bei der Messwertauswahl ausgeschlossen. Die aktuelle Unterbrechung wirkt trotzdem
sofort auf alle offenen Prognosen und öffentlichen Hinweise.

Bei einer aktiven Unterbrechung, im Notfallmodus, bei inaktiver Ressourcengruppe oder ohne aktive
Kapazität wird nicht aus Messwerten fortgeschrieben. Die Prognose fällt auf den Planwert zurück und
kennzeichnet das Ergebnis als `UNCERTAIN`; öffentliche Ansichten zeigen dann keinen Countdown.

Das Alter des jüngsten abgeschlossenen Lernumlaufs bleibt als `dataAgeMinutes` diagnostisch
sichtbar, beeinflusst aber weder `STABLE` noch `CHANGING` und erzeugt allein niemals `UNCERTAIN`.
Die technische Aktualität einer persistierten Prognose wird separat über `prediction_updated_at`
bewertet. Fehlt dieser Zeitpunkt, ist er ungültig oder liegt er mehr als fünf Minuten zurück, gilt
die gespeicherte Prognose als `UNCERTAIN`, bis eine erfolgreiche Neuberechnung vorliegt.

Korrekturen verändern das append-only Ereignisprotokoll nicht. Nur der daraus bestätigte aktuelle
Umlaufzustand entscheidet, ob eine Dauer als abgeschlossener Messwert berücksichtigt wird.

Der adaptive Gate-Vorlauf verwendet ausschließlich Beobachtungen des aktuellen Veranstaltungstags.
Er wird aus der Zeit zwischen automatischem Voraufruf und bestätigtem Boarding robust nachgeregelt
und bleibt intern zwischen sechs und achtzehn Minuten begrenzt. Die angestrebte Gate-Wartezeit ist
ein Optimierungsziel und keine harte Auslösesperre.
