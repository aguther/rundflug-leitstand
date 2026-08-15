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

## Ratchet-Anhebung vom 12. August 2026

Nach den Sonar-orientierten Domain- und Worker-Refactorings wurde die unveränderte vollständige
Grundmenge auf Commit `9ee468ab27b4e3decd19face88e1c60453c695d9` erneut gemessen. Der Lauf
bestand mit 306 Testdateien, 1.664 erfolgreichen und sechs gezielt übersprungenen Tests:

| Kennzahl | Messwert | neue abgerundete Mindestschwelle |
| --- | ---: | ---: |
| Statements | 62,91 % (10.838 / 17.227) | 62 % |
| Branches | 56,93 % (8.339 / 14.647) | 56 % |
| Functions | 60,01 % (2.676 / 4.459) | 60 % |
| Lines | 64,80 % (10.149 / 15.661) | 64 % |

Die höheren Schwellen verhindern, dass die erreichte Bestandsabdeckung in folgenden Paketen wieder
verloren geht. Sie sind weiterhin ein Ratchet, nicht das Ziel: Nach jedem reproduzierbar höheren
Paket werden sie erneut auf den abgerundeten Messwert angehoben. Es wurden keine neuen
Coverage-Exclusions hinzugefügt.

## Ratchet-Anhebung vom 15. August 2026

Nach der Entfernung quelltextgekoppelter Tests und dem Ausbau der verhaltensbasierten Datenbank-,
Worker-, Domain- und DOM-Tests wurde die vollständige Grundmenge erneut gemessen. Der Lauf bestand
mit 306 Testdateien, 1.788 erfolgreichen und sechs gezielt übersprungenen Tests:

| Kennzahl | Messwert | neue abgerundete Mindestschwelle |
| --- | ---: | ---: |
| Statements | 81,50 % (15.954 / 19.574) | 81 % |
| Branches | 71,99 % (10.916 / 15.163) | 71 % |
| Functions | 80,70 % (4.190 / 5.192) | 80 % |
| Lines | 84,01 % (14.772 / 17.583) | 84 % |

Zusätzlich prüft `scripts/verify_domain_coverage.mjs` zehn sicherheits- und betriebskritische
Domainmodule einzeln auf mindestens 90 % Line- und 85 % Branch-Coverage. Der niedrigste gemessene
Line-Wert beträgt 94,44 %, der niedrigste Branch-Wert 85,07 %. Die nach Entfernung der
Quelltextassertionen gestiegenen globalen Werte sind damit kein Effekt künstlicher Artefakttests.
