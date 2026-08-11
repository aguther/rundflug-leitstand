# Coverage-Ratchet vom 11. August 2026

## Ziel und Grundmenge

Der LCOV-Bericht erfasst nicht mehr nur während der Tests importierte Dateien. `vitest.config.ts`
nimmt alle ausführbaren JavaScript- und TypeScript-Dateien unter `apps` und `packages` ausdrücklich
in die Coverage-Grundmenge auf. Damit erscheinen auch vollständig unimportierte Produktionsmodule
mit 0 Prozent im Nenner, insbesondere der Event Coordinator, mehrere Command Services sowie große
UI- und Simulationsmodule.

Ausgeschlossen sind ausschließlich:

- Test- und Worker-Spec-Dateien,
- TypeScript-Deklarationen einschließlich der von Wrangler erzeugten Bindings,
- `dist`- und lokale `.wrangler`-Ausgaben.

Die Exklusion wird nach dem Source-Map-Remapping erneut angewendet. Roh importierte JSON-, SQL- oder
Dokumentationsdateien können den ausführbaren Nenner dadurch nicht künstlich verändern. Das private
Paket `packages/testkit` bleibt bewusst enthalten, weil es eine ausführbare Quelldatei und keine
Deklaration oder generierte Bindings enthält.

## Gemessener Stand und Ratchet

Messbasis war Commit `e02bd81eada9225e2a4956ca7af995a73c99c8f3`. Der Lauf
`npm run test:coverage` bestand mit 293 Testdateien und 1.532 erfolgreichen Tests; sechs Tests waren
für diesen instrumentierten Lauf gezielt übersprungen. Die vollständig gemessene Grundmenge ergab:

| Kennzahl | Messwert | abgerundete Mindestschwelle |
| --- | ---: | ---: |
| Statements | 56,65 % (8.985 / 15.858) | 56 % |
| Branches | 50,47 % (6.926 / 13.723) | 50 % |
| Functions | 54,69 % (2.192 / 4.008) | 54 % |
| Lines | 58,29 % (8.434 / 14.468) | 58 % |

Vitest bricht den Coverage-Lauf ab, sobald eine dieser vier Schwellen unterschritten wird. Die
Schwellen sind ein Ratchet und kein Zielzustand: Eine spätere Anhebung folgt erst auf einen
reproduzierbar höheren Gesamtwert; eine Absenkung benötigt eine ausdrückliche technische
Begründung. SonarQube Clouds separates Ziel von 80 Prozent Coverage auf neuem Code bleibt
unverändert und wird nicht durch die niedrigeren Bestands-Ratchets ersetzt.

Die zwei besonders rechenintensiven Forecast-Testdateien sowie ein einzelner 300-Gruppen-Test
bleiben nur im instrumentierten Lauf ausgenommen. Die zugehörigen Produktionsdateien bleiben im
Coverage-Nenner und die Tests weiterhin Bestandteil von `npm test` und `npm run check`.
