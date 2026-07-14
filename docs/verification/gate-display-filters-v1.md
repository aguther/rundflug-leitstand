# Gate-Zuordnungen und Anzeigefilter V1

Status: umgesetzt und in der Administrationsoberfläche geprüft.

Betroffene Anforderung: D-070.

- Bezeichnung, Gate-Art, Aktivstatus und Reihenfolge bleiben direkte Gate-Stammdaten.
- Zugeordnete Ressourcengruppen werden eindeutig aus `resource_groups.gate_id` abgeleitet und im
  Operationsboard als `assignedResourceGroupIds` ausgegeben.
- Migration 0031 ergänzt einen typisierten Filter aus Produkt-IDs und Umlaufstatus. Leere Listen
  bedeuten jeweils „alle“ und erhalten das bisherige Anzeigeverhalten.
- Filter mit unbekannten Produkt-IDs werden abgelehnt; veraltete Schreibstände bleiben durch die
  Eventversion geschützt.
- Der Gate-Editor erklärt Gate-Art, Anzeige-Reihenfolge und Aktivstatus, zeigt die abgeleiteten
  Ressourcengruppen und bietet Produkt- sowie Umlaufstatusfilter ohne technische JSON-Eingabe an.
- Das öffentliche Board akzeptiert optional `gateId`. Nur für diesen Abruf werden Gate,
  Produktfilter und Statusfilter angewendet. Der allgemeine FIDS-Abruf bleibt unverändert.
- Beim Neustart mit übernommenen Stammdaten werden Produkt-IDs im Filter auf die neu erzeugten IDs
  abgebildet. Filter enthalten keine Namen, Telefonnummern oder öffentlichen Ticketcodes.

Der lokale Integrationstest `npm run test:master-data` belegt Speicherung, ungültige Referenz,
abgeleitete Ressourcengruppenzuordnung und die wirksame Filterung zweier synthetischer Produkte im
öffentlichen Board. Die Browserprüfung vom 14. Juli 2026 wies den typisierten Editor, verständliche
Leerzustände und eine kontraststabile Darstellung in Light und Dark nach.
