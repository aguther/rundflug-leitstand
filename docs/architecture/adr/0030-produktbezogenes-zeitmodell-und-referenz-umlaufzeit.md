# ADR-0030: Produktbezogenes Zeitmodell und abgeleitete Referenz-Umlaufzeit

## Status

Teilweise ersetzt durch ADR-0031 – Release 1.10.0

## Kontext

Die Ressourcengruppe führte historisch eine eigene `planned_rotation_minutes`, obwohl die operative
Produktdauer bereits als `reference_duration_minutes` vorhanden war. Beide Werte konnten
auseinanderlaufen und ließen offen, welcher Wert die Prognose steuert. Zugleich bezeichnete die
Administration die Produktdauer nur als „Referenzdauer“ und die reine Produktinformation
`promised_flight_minutes` als „zugesagte Flugzeit“. Dadurch waren weder Ereignisgrenzen noch die
Trennung von operativer Planung und Gastkommunikation eindeutig.

Die bestehende Prognose verwendet bereits die Produktdauer zusammen mit den veranstaltungsweiten
Boarding-, Ausstiegs- und Pufferzeiten. Eine flugzeugspezifische Zeitsteuerung ist nicht Gegenstand
dieser Entscheidung.

## Entscheidung

Die Ressourcengruppe besitzt keine eigene Umlaufzeit. `planned_rotation_minutes` wird in einer
vorwärtsgerichteten Migration entfernt und aus aktuellen Kommandos, DTOs, Exporten und
Simulationsformaten gestrichen. Alte Stammdatenvorlagen dürfen `plannedRotationMinutes` beim Import
noch enthalten; der Wert wird ausschließlich zur Eingangsnormalisierung verworfen und nie
persistiert oder exportiert.

Die Zeitanteile besitzen folgende verbindliche Semantik:

- **Boardingzeit:** bestätigter Boarding-Aufruf bis bestätigter Offblock; veranstaltungsweit.
- **Referenzzeit Offblock–Onblock:** operative Produkt-Planzeit vom bestätigten Offblock bis zum
  bestätigten Onblock. Das technische Feld `referenceDurationMinutes` bleibt kompatibel.
- **Ausstiegszeit:** bestätigter Onblock bis zum bestätigten Abschluss des Ausstiegs und der
  unmittelbar notwendigen Bodenabfertigung; veranstaltungsweit.
- **Betrieblicher Puffer:** zusätzliche geplante Reserve nach dem Ausstieg; veranstaltungsweit.
- **Kommunizierte Flugzeit:** gegenüber Gästen angegebene oder verkaufte Produktinformation ohne
  Wirkung auf die operative Prognose. Das technische Feld `promisedFlightMinutes` bleibt
  kompatibel.

Die Referenz-Umlaufzeit wird nicht als konfigurierbarer Stammdatenwert gespeichert:

`Boardingzeit + Referenzzeit Offblock–Onblock + Ausstiegszeit + betrieblicher Puffer`

Prognose-Snapshots dürfen die zu diesem Zeitpunkt abgeleitete Referenz-Umlaufzeit als
nachvollziehbare Rechengrundlage festhalten. Daraus entsteht keine zweite Quelle der Wahrheit.

Die reine Funktion `deriveReferenceRotationBreakdown` in `packages/domain` ist die gemeinsame
Berechnungsgrundlage für Prognose und administrative Erläuterung. Ist-Ereignisse, adaptive
Dauerlernung, Unsicherheitsintervalle und Queue-Disposition bleiben fachlich unverändert.

## Folgen

- Produkte sind die einzige Quelle der operativen Offblock–Onblock-Planzeit.
- Veranstaltungsparameter bleiben die einzige Quelle der drei Bodenzeitanteile.
- Ressourcengruppen, Flugzeuge und kommunizierte Flugzeiten erhalten keine Prognosezeit-Semantik.
- Die Administration zeigt die vollständige Referenz-Umlaufzeit transparent als abgeleiteten Wert.
- Historische Migrationen, Ledger-Einträge und unveränderliche binäre Anforderungsquellen werden
  nicht umgeschrieben.
- Die Entscheidung konkretisiert `F-RES-010`, `F-RES-060`, `F-BRD-100`, `F-PRG-030`, `D-015` und
  `D-020`.
