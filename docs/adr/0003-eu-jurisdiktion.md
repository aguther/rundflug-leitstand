# ADR-0003: EU-Jurisdiktion für persistente Cloudflare-Daten

- Status: Akzeptiert mit offener Restfrage
- Datum: 2026-07-11

## Entscheidung

Produktions- und Abnahmedatenbanken, Durable Objects und R2-Buckets werden mit EU-Jurisdiktion
angelegt beziehungsweise adressiert. Das Durable Object wird über `namespace.jurisdiction("eu")`
aufgelöst.

## Offene Restfrage

Zu klären ist, ob zusätzlich jede Worker-Ausführung innerhalb der EU garantiert werden muss. Diese
Anforderung kann andere Cloudflare-Produkte beziehungsweise vertragliche Vereinbarungen erfordern.
