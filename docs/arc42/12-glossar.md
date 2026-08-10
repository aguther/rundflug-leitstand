# 12. Glossar

## 12.1 Fachbegriffe

| Begriff | Bedeutung |
| --- | --- |
| Veranstaltung / Betriebstag | äußeres Aggregat eines Rundflugtages (`operation_days`) mit Zuständen `PREPARATION`, `ACTIVE`, `CLOSED`, `ARCHIVED` und der maßgeblichen Nebenläufigkeitsversion |
| Ressourcengruppe | organisatorische Einheit aus einem oder mehreren Flugzeugen mit genau einer operativen Queue; Zustände `ACTIVE`, `PAUSED`, `INTERRUPTED`, `ENDED` |
| Produkt | verkaufbares Angebot mit Preis, Kapazität, Gewichtsklassen und Referenzzeit Offblock–Onblock; verwendet genau eine Ressourcengruppe |
| Gate | eigenständige Stammdatenposition für den Ort des Boardings; wird historisch am Umlauf festgehalten |
| Buchungsgruppe | gemeinsam verkaufte, unteilbare Ticketmenge (`ticket_groups`) |
| Fluggruppe | operative Einreihung in die Queue einer Ressourcengruppe mit stabiler Kommunikationsnummer (`flight_groups`) |
| Kommunikationsnummer | je Veranstaltung und Ressourcengruppe eindeutige Fluggruppennummer; keine Uhrzeitzusage, keine Flugzeugbindung |
| Umlauf (Rotation) | konkreter Flugvorgang mit Zuständen `DRAFT`, `CALLED`, `IN_FLIGHT`, `LANDED`, `COMPLETED` |
| Turnaround | vollständiger Bodenprozess bis zur erneuten Verfügbarkeit des Flugzeugs; endet mit `MARK_COMPLETED`, nicht mit der Landung |
| Voraufruf | automatischer, ressourcenfreier Aufruf einer Fluggruppe zum Gate (`AUTOMATIC_PRECALL`, öffentlich „Bitte zum Gate“) |
| Gruppennachruf | eigenständiger, temporärer Vorgang zum erneuten Rufen einer Gruppe; kein Ticketzustand |
| Zurückstellung | Wiedereinreihung einer vollständigen Gruppe; nach Erreichen der Grenze Übergang in `CLARIFICATION` (Klärung Kasse) |
| No-Show | ausgebliebene Gruppe nach abgelaufener Frist; auditiertes Ereignis |
| Weicher Betriebsplan | vorgemerkte, ungefähre Einschränkung als reiner Prognoseeingang ohne Zustandswirkung |
| Wiederkehrende Betriebsregel | veranstaltungsbezogene Regel für Pausen oder Betankung nach Umläufen oder Betriebsminuten; erzeugt nur Planeinträge |
| Notfallmodus | auditierter Ausnahmezustand, der scheinpräzise öffentliche Prognosen unterdrückt |
| Papier-Rückfallebene | dokumentierter Ausfallbetrieb mit anschließender Nacherfassung im Vier-Augen-Prinzip |
| Prognosequalität | `STABLE`, `CHANGING` oder `UNCERTAIN`; steuert Intervallbreite und öffentliche Formulierung |
| Planzeit / Prognosezeit / Ist-Zeit | einmalig abgeleitete Planung, laufend berechnete Erwartung, ausschließlich aus bestätigten Kommandos erfasste Realität |

## 12.2 Technische Begriffe

| Begriff | Bedeutung |
| --- | --- |
| ADR | Architecture Decision Record unter `docs/adr/` |
| Aggregatversion | monoton steigende Version von Veranstaltung, Ressourcengruppe, Fluggruppe, Umlauf oder Ticketgruppe; Grundlage von `expectedVersion` |
| `commandId` | vom Client erzeugter Idempotenzschlüssel eines Kommandos |
| `expectedVersion` | erwartete Version zum Zeitpunkt der Bedienung; Abweichung ergibt `STALE_VERSION` |
| Idempotenzbeleg | in `idempotency_receipts` gespeicherte Antwort eines bereits verarbeiteten Kommandos |
| Outbox | Tabelle für nachgelagerte Zustellungen (insbesondere Web Push), gemeinsam mit dem Fachzustand geschrieben |
| Event Ledger | append-only `operational_events`; `UPDATE` und `DELETE` sind durch D1-Trigger verboten |
| Durable Object | Cloudflare-Baustein mit garantiert einer aktiven Instanz je Schlüssel; hier `EventCoordinator` je Veranstaltung |
| Hibernation | Cloudflare-WebSocket-Modus, der Verbindungen ohne dauerhaft laufende Instanz hält |
| D1 | Cloudflare-verwaltete SQLite-Datenbank; relationale Source of Truth |
| R2 | Cloudflare-Objektspeicher (hier mit EU-Jurisdiktion) für Sicherungen, Veranstaltungslogos und Analysepakete |
| Time Travel | D1-Wiederherstellung auf einen früheren Zeitpunkt |
| Rate-Limiting-Binding | Cloudflare-Bindung zur Begrenzung von Fehlversuchen (30/60 s öffentlich, 5/60 s Adminwiederherstellung) |
| DTO | reduzierte, rollenabhängige Antwortstruktur; öffentliche DTOs enthalten keine internen Aggregate |
| PWA | installierbare Webanwendung mit Service Worker, Offline-Snapshot und rollenbezogenem Manifest |
| FIDS | öffentliche Anzeigetafel (Flight Information Display System) für Monitore |
| VAPID | Signaturverfahren für Web Push (RFC 8292); hier mit der nativen Web-Crypto-API des Workers umgesetzt |
| `SUPPORT_SAFE` | Allowlist-Projektion für Diagnose- und Analyseexporte ohne Codes, Tokens oder Personenbezug |
| Guardrail | ausführbare Regel (`npm run refactor:guardrails`) für Dateibudgets und verbotene Importmuster |
| OQ | offene fachliche Frage in `docs/requirements/open-questions.md` |
| Traceability | Zuordnung von Anforderungs-IDs zu Modulen, Tests und Status in `docs/requirements/traceability-v1.12.0.csv` |

## 12.3 Rollen und Kommandos

| Rolle | Kürzel im System | Typische Kommandos |
| --- | --- | --- |
| Kasse | `CASHIER` | `SELL_TICKET_GROUP`, Storno, Korrektur, Zurückstellung |
| Flight Line | `FLIGHT_LINE` | `CALL_NEXT`, `MARK_IN_FLIGHT`, `MARK_LANDED`, `MARK_COMPLETED`, `REVOKE_CALL`, `START_TICKET_GROUP_RECALL` |
| Flight Director | `FLIGHT_DIRECTOR` | Disposition, Flotten- und Pilotenzustände, Unterbrechung, Notfallmodus, weicher Betriebsplan |
| Administration | `ADMIN` | Stammdaten, Veranstaltungsparameter, Konten, Vorlagen, Werksreset, Auswertung |
| Anzeige | `DISPLAY` | keine Schreibkommandos; ausschließlich gebundene Boardprojektion |
