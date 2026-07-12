# Verifikation Nacherfassungsgrundlage

Stand: 12.07.2026

Die Domänensimulation deckt folgende OQ-08-Regeln automatisiert ab:

- Sortierung nach ursprünglicher Ereigniszeit und Papier-Belegfolge,
- vollständige Folge Verkauf → Aufruf → `IM FLUG` → `GELANDET` → `ABGESCHLOSSEN`,
- Ablehnung logisch unmöglicher Übergänge,
- Erkennung bereits vorhandener und unbekannter Papierbezüge,
- Erkennung doppelter Belegfolgen und zukünftiger Originalzeiten.

Die Transportverträge erlauben keine unbekannten Felder und weisen Gastidentitäten zurück. Die lokale
D1-Neuanlage mit allen 19 Migrationen wurde erfolgreich geprüft. Das additive Schema speichert auch
konfliktbehaftete Quellzeilen für die Vorsimulation, ohne sie auf den Livezustand anzuwenden.

Dieser Nachweis schließt OQ-08 noch nicht vollständig: Die tatsächliche Anwendung bleibt bis zur
Implementierung der erneuten stale-Prüfung bei Freigabe und der Vier-Augen-Freigabe gesperrt.

## Auditierte Batch-Anlage

Das Kommando `STAGE_OUTAGE_RECOVERY` läuft über das Event-Durable-Object und verlangt gekoppeltes
Gerät, passende Rolle, Idempotenz-ID und erwartete Event-Version. Kassen dürfen nur Papierverkäufe,
Leiter Flight Line nur Umlaufereignisse und Administratoren beide Arten anlegen. Simulation, Batch,
Quellzeilen, Audit-Ereignis, Idempotenzbeleg und Outbox werden gemeinsam gespeichert. Öffentliche
Ticketcodes werden vor der Persistenz gehasht und erscheinen weder im Audit-Payload noch in Logs.

Migration 0019 wurde am 12.07.2026 erfolgreich auf die Cloudflare-Abnahme-D1 angewendet.

## Vier-Augen-Freigabe

`APPROVE_OUTAGE_RECOVERY` ist ausschließlich für ein gekoppeltes Administratorgerät mit gültiger PIN
zulässig. Das freigebende Gerät muss vom Erfassungsgerät verschieden sein. Freigegeben werden nur
konfliktfreie Batches im Status `STAGED`; außerdem muss die Event-Version exakt der bei Simulation
verwendeten Version plus dem auditierenden Staging-Schritt entsprechen. Jede zwischenzeitliche
Änderung erzwingt eine neue Simulation. Freigabe, Event-Version, Audit, Idempotenzbeleg und Outbox
werden gemeinsam gespeichert.

## Geordnete Live-Anwendung

`APPLY_OUTAGE_RECOVERY` prüft erneut Administratorrolle, PIN, Batchstatus und Event-Version. Ein
freigegebener Batch wird vollständig in einem D1-Batch angewendet oder gar nicht. Papierverkäufe
erzeugen Ticketgruppe, gehashte Tickets, stabile Fluggruppe und Umlauf; Flight-Line-Einträge führen
denselben Papierbezug in der erlaubten Reihenfolge bis `ABGESCHLOSSEN` fort. Jede fachliche Zeile
erzeugt ein Ledger-Ereignis mit `recordedAfterOutage`, ursprünglicher Zeit, Batch-ID,
Nacherfassergerät und anonymer Papierbelegreferenz. Ticketcodes erscheinen weder im Ledger noch in
Ausgaben.

Der reproduzierbare Befehl `npm run test:outage-recovery` setzt eine synthetische lokale D1 neu auf
und prüft getrennte Kassen- und Flight-Line-Lead-Batches samt anderem Administratorgerät. Ergebnis am
12.07.2026: beide Batches `STAGED → APPROVED → APPLIED`, finale Event-Version 6 und ein vollständig
abgeschlossener nacherfasster Umlauf. Migration 0020 wurde anschließend erfolgreich auf die
Cloudflare-Abnahme-D1 angewendet.
