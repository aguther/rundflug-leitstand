# AP-08 – Nachweis für gebündelte Lesezugriffe und Operations-Projektion

Stand: 11. August 2026

## Ziel und Grenzen

AP-08 reduziert D1-Roundtrips und wiederholte lineare Suchen in zwei stark genutzten Lesepfaden,
ohne Transportverträge, fachliche Zustandsübergänge oder Persistenzschemata zu ändern. Die
Optimierung betrifft ausschließlich das Laden und Projizieren bestätigter Daten.

## Verbindliche Budgets

| Pfad | Synthetisches Mengengerüst | Grenze |
| --- | --- | --- |
| Master-Data-Templatevalidierung | 200 Flugzeugregistrierungen | genau eine parametrierte Registrierungsabfrage |
| Operations-Read-Service | 14 unabhängige Kernmodelle | genau ein D1-Batch mit 14 vorbereiteten Statements |
| Optionale Flight-Line-Assist-Kompatibilität | ein zusätzliches Read Model | höchstens eine getrennte Abfrage im Normalpfad |
| Legacy-Gate-Schema | fehlende Spalte `gates.display_filter_json` | genau ein Wiederholungsbatch mit leerer Filterprojektion |
| Operations-Projektion | 300 Umläufe mit insgesamt 1.200 Tickets | weniger als 500 ms im deterministischen Unit-Test |

## Umsetzung

- `d1-read-scheduler.ts` kapselt typisierte `all`- und `first`-Projektionen und prüft, dass D1 für
  jedes vorbereitete Statement genau ein positionsgleiches Ergebnis liefert.
- `operations-read-query-plan.ts` bereitet die 14 unabhängigen Kernabfragen vor und sendet sie gemeinsam
  über `D1Database.batch()`. Der vorhandene Schema-Fallback wiederholt den Batch nur für die konkret
  erkannte fehlende Gate-Filterspalte.
- `operations-projection-indexes.ts` stellt kleine reine Hilfen für eindeutige und gruppierte Maps
  bereit. `operations-response-projector.ts` baut diese Indizes einmalig auf und verwendet sie in den
  nachfolgenden Projektionen.
- `admin-master-data-template-aircraft-validation.ts` übergibt die normalisierten Registrierungen
  als JSON-Array an SQLite `json_each`; dadurch steigt die Abfragezahl nicht mit der Templategröße.

## Automatisierter Nachweis

Die folgenden Produktionsgrenzen und Tests sichern das Verhalten als Regression-Gates:

- `apps/worker/src/d1-read-scheduler.test.ts`
- `apps/worker/src/operations-read-service.test.ts`
- `apps/worker/src/operations-routes.test.ts`
- `apps/worker/src/operations-response-projector.ts`
- `apps/worker/src/admin-master-data-template.test.ts`

Gezielter Prüfbefehl:

```bash
npm exec -- vitest run apps/worker/src/d1-read-scheduler.test.ts apps/worker/src/operations-read-service.test.ts apps/worker/src/operations-routes.test.ts apps/worker/src/admin-master-data-template.test.ts
```

Die abschließende Repository-Abnahme erfolgt zusätzlich über `npm run check`, einschließlich echter
Worker-Runtime- und Skalierungsprüfungen.
