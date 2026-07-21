# Rundflug-Leitstand – Arbeitsanweisung für Codex und Entwickler

## Mission

Implementiere die Ausbaustufe V1 des Rundflug-Leitstands gemäß Release
`docs/requirements/requirements-v1.7.0.md`. Das System ist kein einfaches Ticketing, sondern koordiniert
Verkauf, Ressourcengruppen-Queues, Flight-Line-Ereignisse, Prognosen, öffentliche Statusanzeigen und
Auditierung.

## Quellen der Wahrheit

1. `docs/requirements/requirements-v1.7.0.md`
2. `docs/requirements/requirements-v1.7.0.yaml`
3. die fortgeltenden Kataloge V1.4, V1.5 und V1.6.0 in `docs/requirements/`
4. freigegebene ADRs in `docs/adr/`
5. automatisierte Tests
6. diese `AGENTS.md`

Binäre PDF-/DOCX-Dateien dienen als unveränderte Referenz. Ändere keine Anforderung stillschweigend.
Dokumentiere Unklarheiten in `docs/requirements/open-questions.md`.

## Nicht verhandelbare fachliche Invarianten

- Ein Produkt verwendet genau eine Ressourcengruppe.
- Ein Flugzeug darf zu einem Zeitpunkt höchstens einer aktiven Ressourcengruppe angehören.
- Jede Ressourcengruppe besitzt genau eine operative Queue.
- Eine Fluggruppen-/Slotnummer ist eine stabile Kommunikationskennung, keine garantierte Uhrzeit und
  keine dauerhafte Flugzeugbindung.
- Die konkrete Flugzeugzuordnung bleibt bis zur operativen Bestätigung flexibel.
- Ein Ticket darf höchstens einem nicht abgeschlossenen Umlauf zugeordnet sein.
- Gruppen werden niemals automatisch getrennt. Eine beim Verkauf sichtbar ausgewiesene Aufteilung
  entsteht nur durch die bewusste Verkaufsaktion; die Buchungsgruppe bleibt dabei verbunden.
- Nach `NEXT` beziehungsweise Aufruf erfolgt keine automatische Umbesetzung. Das System darf nur einen
  Vorschlag zur menschlichen Bestätigung machen.
- Ist-Ereignisse treiben die Prognose. Planzeit, Prognosezeit und Ist-Zeit bleiben getrennt.
- `GELANDET` bedeutet nicht automatisch `VERFÜGBAR`. Ein Abschluss-/Verfügbarkeitsereignis schließt den
  Turnaround.
- Jede operative Zustandsänderung erzeugt einen append-only Audit-Eintrag.
- Schreibkommandos sind idempotent und prüfen eine erwartete Version.
- Veraltete konkurrierende Schreibversuche werden abgelehnt und niemals still überschrieben.
- Im Kernsystem werden keine Gastnamen gespeichert.
- Öffentliche Nutzer sehen Zeitfenster oder Wartepositionen, keine garantierten Uhrzeiten.
- Hinweise zu Gewicht, Kraftstoff oder Zuladung besitzen niemals Freigabesemantik.
- Die Anwendung trifft keine flugbetriebliche, sicherheitsrelevante oder luftrechtliche Entscheidung.

## Architektur

- TypeScript durchgängig.
- React/Vite-PWA in `apps/web`.
- Cloudflare Worker in `apps/worker`.
- D1 als relationale Source of Truth.
- SQLite-basiertes Durable Object je Veranstaltung für serialisierte Kommandos und WebSockets.
- R2 für portable Sicherungen und Berichte.
- Reine Fachlogik gehört in `packages/domain` und darf keine Cloudflare-, HTTP-, UI- oder
  Datenbankabhängigkeit besitzen.
- Transportverträge gehören in `packages/contracts`.
- UI-Komponenten führen keine fachlichen Zustandsübergänge selbst aus.
- Worker-Routen duplizieren keine Domänenregeln.
- Bestätigte Änderungen, Event Ledger, Idempotenzbeleg und Outbox werden atomar beziehungsweise in
  einer fachlich konsistenten D1-Batch-/Transaktionsgrenze gespeichert.
- Realtime-Veröffentlichung erfolgt erst nach erfolgreicher Persistenz.
- Cloudflare-spezifische Implementierung bleibt in Adaptern außerhalb des Domain-Pakets.

## Erforderliche Befehle

```bash
npm install
npm run lint
npm run typecheck
npm run test
npm run build
npm run requirements:verify
npm run check
```

## Arbeitsmethode

- Beginne mehrstufige Aufgaben mit einem aktualisierten Ausführungsplan.
- Vom Auftraggeber beauftragte und vollständig geprüfte Korrekturen werden standardmäßig direkt auf
  `main` committed und gepusht, sofern der Auftraggeber nicht ausdrücklich etwas anderes vorgibt.
- Bearbeite pro Branch und Pull Request genau ein zusammenhängendes Ergebnis.
- Referenziere Anforderungs-IDs in Issues, Tests und Pull Requests.
- Ändere die binären Anforderungsquellen nicht im Rahmen von Feature-Arbeit.
- Führe keine neue Abhängigkeit ohne dokumentierten Zweck ein.
- Verwende ausschließlich synthetische Daten in Entwicklung und Tests.
- Logge niemals Telefonnummern, Ticket-Tokens, Administrator-PINs oder Secrets.
- Datenbankmigrationen benötigen eine Rollback- oder Wiederherstellungsnotiz.
- Schwäche keine Invariante ab, nur damit ein Test besteht.
- Für UI-Arbeit zunächst vollständige Konzepte für die betroffene Oberfläche erzeugen und freigeben,
  danach implementieren und im Browser gegen das Konzept prüfen.
- Kein generisches Karten-Dashboard anstelle der vorgeschriebenen Ein-Bildschirm-Abläufe für Kasse und
  Flight Line.

## Definition of Done

Eine Änderung ist nur fertig, wenn:

- alle referenzierten Anforderungen umgesetzt sind,
- Unit-, Integrations- und E2E-Tests dem Risiko angemessen vorhanden sind,
- Lint, Typprüfung, Tests und Build erfolgreich sind,
- Berechtigung, Idempotenz, Concurrency und Auditierung geprüft wurden,
- öffentliche und operative Zustände im Browser geprüft wurden,
- Traceability und Dokumentation aktualisiert wurden,
- keine personenbezogenen Daten oder Secrets in Diff, Logs oder Testfixtures auftauchen,
- der finale Diff auf Regressionen und Datenexposition geprüft wurde.

## Hochkritische Review-Funde

Behandle insbesondere als hohe oder kritische Priorität:

- mögliche doppelte Tickets, Flüge oder Zustandsübergänge,
- Verletzung des Gruppenschutzes,
- gleichzeitige aktive Zuordnung eines Flugzeugs zu mehreren Ressourcengruppen,
- akzeptierte stale writes,
- fehlende Audit-Ereignisse,
- personenbezogene Daten oder öffentliche Tokens in Logs,
- sicherheitsbezogene Freigabesemantik,
- unautorisierte operative Kommandos,
- aufzählbare öffentliche Ticketcodes,
- Änderungen, die Offline-Wiederherstellung oder Live-Synchronisation beschädigen.
