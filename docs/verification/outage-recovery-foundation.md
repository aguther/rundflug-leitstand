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

Migration 0019 wurde am 12.07.2026 erfolgreich auf die Cloudflare-Abnahme-D1 angewendet. Weiterhin
gesperrt bleiben Vier-Augen-Freigabe und Live-Anwendung des Batches.
