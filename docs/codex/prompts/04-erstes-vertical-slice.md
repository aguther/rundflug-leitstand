# Codex-Prompt 04 – Erstes Vertical Slice

```text
Arbeite zuerst im Plan-Modus.

Ziel:
Implementiere den ersten vollständigen Vertical Slice vom Ticketverkauf bis zum abgeschlossenen und
wieder verfügbaren Rundflug.

Vor Beginn:
- Lies AGENTS.md.
- Ermittle aus `requirements-v1.6.1.yaml` und den fortgeltenden Basiskatalogen die konkreten
  Anforderungs-IDs.
- Aktualisiere traceability.csv.
- Stelle blockierende Fachfragen, bevor du Annahmen über Statusübergänge triffst.

Fachlicher Minimalablauf:
1. Administrator legt einen Veranstaltungstag an.
2. Administrator legt eine Ressourcengruppe an.
3. Administrator ordnet genau ein Flugzeug aktiv zu.
4. Administrator legt ein Produkt an, das diese Ressourcengruppe verwendet.
5. Kasse verkauft eine synthetische Ticketgruppe.
6. Die Gruppe erscheint in der Queue der Ressourcengruppe.
7. Flight Line führt NEXT aus.
8. Flight Line erfasst IM FLUG.
9. Flight Line erfasst GELANDET.
10. Flight Line erfasst ABGESCHLOSSEN/VERFÜGBAR.
11. FIDS und öffentliche Ticketstatusseite aktualisieren sich live.
12. Jeder Übergang ist im Event Ledger nachvollziehbar.

Technische Anforderungen:
- Kommandos sind idempotent.
- Jeder Schreibzugriff prüft Expected-Version.
- Zustand, Event Ledger, Idempotenzbeleg und Outbox sind konsistent gespeichert.
- Realtime-Veröffentlichung erfolgt erst nach Persistenz.
- Domänenlogik liegt in packages/domain.
- UI enthält keine eigene Übergangslogik.
- Eine injizierbare Uhr ermöglicht deterministische Tests.
- Alle Daten in Tests sind synthetisch.

Fertig, wenn:
- Unit-Tests zulässige und unzulässige Übergänge prüfen,
- ein D1-/Worker-Integrationstest den Ablauf ausführt,
- ein Browser-E2E-Test Kasse, Flight Line, FIDS und Ticketstatus prüft,
- parallele doppelte Kommandos keine Duplikate erzeugen,
- die Ressourcengruppen-Invariante nachweisbar geschützt ist,
- npm run check erfolgreich ist,
- Traceability und Dokumentation aktualisiert sind.
```
