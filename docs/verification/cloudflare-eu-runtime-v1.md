# Cloudflare-EU-Laufzeitnachweis V1

Stand: 15. Juli 2026

Betroffene Anforderung: T-030. Q-DSG-040 wird dadurch nur technisch, nicht rechtlich vollständig
abgedeckt.

## Reale Accountprüfung

Die mit `wrangler.jsonc` gebundenen Cloudflare-Ressourcen wurden nach erfolgreicher Anmeldung
read-only über Wrangler 4.110.0 abgefragt.

```text
npx wrangler d1 info rundflug-leitstand --json
npx wrangler r2 bucket info rundflug-leitstand --jurisdiction eu --json
```

Ergebnis:

- D1 `rundflug-leitstand`, UUID `a7de5fcd-654e-4e9f-ab20-83caaed74c02`:
  `jurisdiction: eu`, `running_in_region: EEUR`, Read Replication deaktiviert.
- R2 `rundflug-leitstand`: Abfrage mit EU-Jurisdiktion erfolgreich,
  `location: EEUR`, vier vorhandene synthetische Betriebs-/Sicherungsobjekte.
- Das Worker-Binding enthält für R2 ausdrücklich `jurisdiction: eu`.
- Der EventCoordinator fordert außerhalb der rein lokalen Entwicklung die Durable-Object-
  Jurisdiktion `eu` an.
- D1 ist relationale Source of Truth, R2 speichert Sicherungen/Berichte und das Durable Object
  serialisiert Kommandos; damit liegen die zentralen zustandsführenden Komponenten im EU-Bereich.
- Migration 0032 wurde nach einem geprüften D1-Export angewendet. Der Export liegt unter
  `migration-backups/2026-07-15/pre-0032-20260715-111305.sql` im EU-R2-Bucket; die Remote-Abfrage
  meldete danach keine ausstehenden Migrationen und bestätigte den weiterhin append-only
  geschützten Prognose-Snapshot-Trigger mit ausschließlich kontrollierter Werksreset-Ausnahme.

Cloudflare dokumentiert, dass D1-Jurisdiktionen die Ausführung und Persistenz der Datenbank auf die
gewählte Jurisdiktion beschränken und dass R2 Jurisdictional Restrictions Speicherung und
Verarbeitung innerhalb der gewählten Jurisdiktion garantieren:

- https://developers.cloudflare.com/d1/configuration/data-location/
- https://developers.cloudflare.com/r2/reference/data-location/

## Betriebsabgrenzung

Die Anwendung empfiehlt gemäß T-030 weiterhin einen LTE-/5G-Zugang mit zwei unabhängigen
Mobilfunknetzen; dies ist lokale Veranstaltungsinfrastruktur und keine Softwarekonfiguration.

Q-DSG-040 bleibt offen, bis Auftragsverarbeitungsvertrag, Betreiberangaben und Eintrag für das
Verzeichnis der Verarbeitungstätigkeiten vom Auftraggeber geprüft beziehungsweise bereitgestellt
sind. Der technische EU-Nachweis ersetzt diese Dokumente nicht.

Die offizielle Prüfung vom 14. Juli 2026 hat zusätzlich bestätigt, dass die aktuelle
`workers.dev`-Bereitstellung die strenge OQ-06-Auslegung nicht vollständig erfüllt: EU-beschränkte
TLS-Terminierung und Worker-Ausführung benötigen Regional Services auf einer Custom Domain sowie
für EU-Metadaten eine gesonderte Customer Metadata Boundary. Diese Data-Localization-Funktionen sind
ein Enterprise-Zusatz. Regional Services gilt außerdem nicht für Worker-Subrequests und Cron-Trigger.
Der vollständige Befund und die erforderliche Betreiberentscheidung sind unter
`docs/operations/cloudflare-data-protection-acceptance-v1.md` dokumentiert.

Das aus dem implementierten Schema abgeleitete technische Daten- und Verarbeitungsinventar unter
`docs/operations/privacy-data-inventory-v1.md` dient als ausfüllbare Grundlage für diese Prüfung.
