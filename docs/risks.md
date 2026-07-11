# Technische und betriebliche Risiken

| Risiko | Auswirkung | Gegenmaßnahme |
|---|---|---|
| Mobilfunkzelle überlastet | verzögerte Bedienung | Dual-SIM, Offline-Queue, Papier-Rückfall |
| Cloudflare-Teil- oder Gesamtausfall | zentrale Synchronisation fehlt | letzter Snapshot, Papierprozess, Statusmonitoring |
| stale writes von mehreren Tablets | widersprüchliche Queue | Durable Object, Expected-Version, 409-Konflikt |
| erratbare Ticketcodes | Datenschutzverletzung | kryptografische Tokens, Rate Limit, minimale Antwort |
| D1-Fullscans | Latenz und Kosten | Indizes, Query-Budgets, Lasttests |
| nicht hibernierende WebSockets | unnötige Kosten | Hibernation API und Verbindungsmetriken |
| proprietäre Bindung | Betreiberwechsel erschwert | Domain-Portabilität, SQL-Exporte, Adaptergrenzen |
| fehlgeschlagene Migration am Festtag | Betriebsstillstand | Freeze, Abnahme, Backup, Rollback/Restore |
| falsche Freigabesemantik | Sicherheitsmissverständnis | neutrale Hinweise, Textreview, keine Ampel für Freigaben |
| Account an Privatperson gebunden | Kontroll- und Übergaberisiko | Vereinsaccount, Rollen, zwei Super Admins, 2FA |
