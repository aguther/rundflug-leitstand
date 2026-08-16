# ADR-0056: Mutationstests als Standard-Integrationsgate

- Status: Akzeptiert
- Datum: 2026-08-16
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: V1120-QA-010, V1110-QA-010, Q-ZUV-020

## Kontext

ADR-0046 führte einen fokussierten Mutationstest für neun fachlich kritische Domainmodule ein,
trennte ihn wegen 73,59 Prozent Mutation Score und der damaligen Laufzeit aber vom normalen
PR-Gate. Der aktuelle vollständige Lauf enthielt 1.447 Mutanten. Direkte Grenzwerttests für
Kapazität, Verfügbarkeit, Diagnostik, Dispatch-Replay und robuste Stichproben erhöhten den
reproduzierbaren Score ohne Mutator-Ausschlüsse auf 87,21 Prozent. Alle neun Module erreichen
einzeln mindestens 80 Prozent; ein frischer Lauf benötigt lokal etwa fünf Minuten, inkrementelle
Läufe nach Teständerungen weniger als eine Minute.

## Entscheidung

- `npm run test:mutation` führt Stryker und anschließend ein eigenes Report-Ratchet aus.
- Strykers globaler `break`-Schwellenwert steigt ausschließlich nach oben von 73 auf 87 Prozent;
  `low` bleibt 80 und `high` 90.
- `scripts/verify_mutation_report.mjs` verlangt zusätzlich für jedes der neun ausgewählten Module
  mindestens 80 Prozent. Ein starker Gesamtwert darf damit kein schwaches Einzelmodul verdecken.
- Die vollständige Mutationsfläche von 1.447 Mutanten bleibt erhalten. Mutatorarten, Fehlertexte
  oder defensive Pfade werden nicht pauschal ausgeschlossen.
- `.github/workflows/mutation-tests.yml` läuft für jeden Pull Request, jeden Push nach `main`,
  wöchentlich und manuell. HTML-, JSON- und Incremental-Berichte bleiben 30 Tage als Artefakt
  verfügbar.

## Folgen

- Jede Änderung erhält vor Integration denselben fachlichen Assertion-Nachweis; eine manuelle
  Entscheidung anhand geänderter Dateipfade entfällt.
- Der globale Score und jedes Modul können nur auf ihrem bestätigten Niveau bleiben oder steigen.
- Überlebende Mutanten bleiben im vollständigen Bericht sichtbar und werden bei betroffenen Regeln
  weiter priorisiert. Sie bilden kein ungemessenes Qualitätsdefizit mehr, weil sowohl Gesamt- als
  auch Modulgrenzen automatisiert und ohne Ausschlüsse erzwungen werden.
- Der zusätzliche PR-Job verlängert die Gesamt-CPU-Zeit, läuft jedoch parallel zu den übrigen
  Qualitätsjobs und verändert deren Rückmeldezeit nicht.

## Verworfene Alternativen

- **Nur den globalen Stryker-Schwellenwert anheben:** könnte ein einzelnes schwaches Forecast-Modul
  hinter starken Queue- oder Turnaroundwerten verbergen.
- **Mutatorarten oder schwer testbare Pfade ausschließen:** würde den Score verbessern, ohne die
  Assertions zu stärken.
- **Mutation weiterhin nur wöchentlich ausführen:** ließe relevante Regressionen bis zum nächsten
  Zeitplanlauf unentdeckt.
