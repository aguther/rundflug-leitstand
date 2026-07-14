# Gate-Zuordnungen und Anzeigefilter V1

Status: Datenmodell, Verträge, Worker und Integrationstest umgesetzt; Administrationsoberfläche
ausstehend.

Betroffene Anforderung: D-070.

- Bezeichnung, Gate-Art, Aktivstatus und Reihenfolge bleiben direkte Gate-Stammdaten.
- Zugeordnete Ressourcengruppen werden eindeutig aus `resource_groups.gate_id` abgeleitet und im
  Operationsboard als `assignedResourceGroupIds` ausgegeben.
- Migration 0031 ergänzt einen typisierten Filter aus Produkt-IDs und Umlaufstatus. Leere Listen
  bedeuten jeweils „alle“ und erhalten das bisherige Anzeigeverhalten.
- Filter mit unbekannten Produkt-IDs werden abgelehnt; veraltete Schreibstände bleiben durch die
  Eventversion geschützt.
- Das öffentliche Board akzeptiert optional `gateId`. Nur für diesen Abruf werden Gate,
  Produktfilter und Statusfilter angewendet. Der allgemeine FIDS-Abruf bleibt unverändert.
- Beim Neustart mit übernommenen Stammdaten werden Produkt-IDs im Filter auf die neu erzeugten IDs
  abgebildet. Filter enthalten keine Namen, Telefonnummern oder öffentlichen Ticketcodes.

Der lokale Integrationstest `npm run test:master-data` belegt Speicherung, ungültige Referenz,
abgeleitete Ressourcengruppenzuordnung und die wirksame Filterung zweier synthetischer Produkte im
öffentlichen Board. D-070 verbleibt bis zur freigegebenen Administrationsoberfläche und sichtbaren
Browserabnahme auf `geplant`.
