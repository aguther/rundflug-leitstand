# Aussagekraft der Mutationstests

- **Status:** offen
- **Priorität:** mittel
- **Evidenz:** Der fokussierte Gate-Lauf vom 15. August 2026 erreichte 73,59 Prozent bei 1.401
  Mutanten; 352 Mutanten überlebten und 18 besaßen keine Coverage.

## Wirkung

Das Mutationstest-Gate schützt neun besonders kritische Domainmodule, weist aber weiterhin
Testlücken auf. Einzelne Forecast-Module liegen unter dem globalen Wert; ein grüner Coverage-Lauf
allein belegt dort nicht die fachliche Aussagekraft aller Assertions.

## Sicherer Abbau

Überlebende Mutanten werden nach fachlichem Risiko priorisiert. Ergänzungen prüfen beobachtbares
Verhalten und dürfen weder Invarianten abschwächen noch interne Implementierungsdetails festschreiben.
Der globale und die modulbezogenen Ratchets werden ausschließlich angehoben. Änderungen an einem
ausgewählten Modul führen vor Integration den vollständigen Mutationstest aus.

## Abschlusskriterium

Alle fachlich relevanten überlebenden und nicht abgedeckten Mutanten sind durch geeignete Tests
getötet oder mit überprüfbarer Begründung ausgeschlossen; das reproduzierbare Gate erreicht
mindestens den konfigurierten `low`-Schwellenwert von 80 Prozent.
