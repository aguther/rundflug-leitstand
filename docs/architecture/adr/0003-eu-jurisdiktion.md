# ADR-0003: EU-Jurisdiktion für persistente Cloudflare-Daten

- Status: Akzeptiert
- Datum: 2026-07-11

## Entscheidung

Produktions- und Abnahmedatenbanken, Durable Objects und R2-Buckets werden mit EU-Jurisdiktion
angelegt beziehungsweise adressiert. Das Durable Object wird über `namespace.jurisdiction("eu")`
aufgelöst.

## Produktionsauflage

OQ-06 wurde streng entschieden: Vor einer Produktionsfreigabe müssen auch Worker-/TLS-/Push-
Verarbeitung und personenbeziehbare Metadaten nachweislich innerhalb der EU verarbeitet werden.
Die aktuelle `workers.dev`-Abnahmeumgebung erfüllt diesen Nachweis nicht allein durch die
EU-Jurisdiktion von D1, R2 und Durable Objects. Regional Services, Customer Metadata Boundary,
Cron-/Push-Subrequests, DPA und Subprozessoren sind gemäß
`docs/operations/cloudflare-data-protection-acceptance-v1.md` durch den Betreiber zu klären oder die
Anforderung beziehungsweise Plattform muss formal geändert werden.
