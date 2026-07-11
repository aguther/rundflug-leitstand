# Priorisiertes technisches und betriebliches Risikoregister

Bewertung: Eintritt `H/M/N`, Auswirkung `kritisch/hoch/mittel/niedrig`. Offene fachliche Entscheidungen
stehen in `docs/requirements/open-questions.md`; dieses Register entscheidet sie nicht vorweg.

| ID | Risiko | Eintritt | Auswirkung | Betroffene Anforderungen | Gegenmaßnahmen | Nachweis | Paket |
|---|---|---:|---:|---|---|---|---|
| R-01 | Parallele oder wiederholte Kommandos erzeugen doppelte Tickets, Umläufe oder Zustandswechsel. | H | kritisch | F-EVT-020, Q-UX-050, Q-ZUV-040, T-100 | Serialisierung je Veranstaltung, `commandId`, `expectedVersion`, atomarer Idempotenzbeleg | Concurrency-, Doppel-Tipp- und Replay-Tests | BP-02, BP-04 |
| R-02 | Event Ledger, relationale Projektion, Idempotenzbeleg und Outbox laufen auseinander. | M | kritisch | F-EVT-010, F-HIS-020, D-090, T-100 | Eine persistente Konsistenzgrenze, keine Veröffentlichung vor Commit, Recovery/Rebuild testen | Fehler-Injektion vor/nach Persistenz und Projektionsvergleich | BP-02, BP-10 |
| R-03 | Offline-Kommandos überschreiben neuere Zustände oder verletzen Gruppen-/Umlaufinvarianten. | H | kritisch | T-035, Q-ZUV-020, Q-ZUV-040, F-INT-070 | Offline-Allowlist erst nach OQ-01, Expected-Version, sichtbare Konfliktauflösung, keine automatische Zusammenführung | 60-Sekunden-Ausfall mit widersprüchlichen Kommandos | BP-09 |
| R-04 | Ein Flugzeug, Ticket oder Pilot wird gleichzeitig mehrfach operativ gebunden. | M | kritisch | F-RES-040, F-BRD-080, D-016, T-100 | Domäneninvarianten plus Datenbank-Constraints und transaktionale Prüfung | Unit- und konkurrierende Integrationstests | BP-03, BP-05 |
| R-05 | Öffentliche Ticketcodes sind erratbar oder sensible Daten gelangen in Antworten/Logs. | M | kritisch | F-KAS-050, F-BEN-010, Q-SIC-030, Q-DSG-010 | Kryptografische Tokens, minimale DTOs, Rate Limits, strukturierte Log-Redaktion | Enumeration-, Autorisierungs- und Log-Exposure-Tests | BP-04, BP-07 |
| R-06 | EU-Jurisdiktion persistenter Daten erfüllt nicht die geforderte EU-Verarbeitung. ADR-0003 lässt diese Frage ausdrücklich offen und kann mit `Q-DSG-040`/`T-030` kollidieren. | M | kritisch | Q-DSG-040, T-030 | OQ-06 fachlich/rechtlich entscheiden, Cloudflare-Vertrag und Datenflüsse nachweisen, ADR danach präzisieren | Datenschutzfreigabe und dokumentierte Providerkonfiguration | BP-11 |
| R-07 | Push-Abonnements oder Telefonnummern werden ohne wirksame Einwilligung verarbeitet oder nicht fristgerecht gelöscht. | M | hoch | F-BEN-020, F-BEN-040, F-BEN-060, D-110, Q-DSG-020, Q-DSG-030 | Consent-Ledger, minimale Daten, konfigurierbare Löschjobs, Retry/Fehlerbericht | Consent-, Widerrufs- und zeitgesteuerte Löschtests | BP-07, BP-10 |
| R-08 | Prognoseberechnung überschreitet zwei Sekunden oder erzeugt scheinpräzise öffentliche Zusagen. | M | hoch | F-PRG-020, F-PRG-080, F-PRG-090, Q-PER-030 | Deterministisches Modell, inkrementelle Eingaben, Unsicherheitsstufen, Lastbudget | 1.000 Tickets/300 Umläufe und UI-Textabnahme | BP-06, BP-12 |
| R-09 | Zeitzonen- oder Sommerzeitfehler verfälschen Ereignisse, Fristen und Berichte. | M | hoch | T-060, D-090, D-100 | UTC-Persistenz, Event-Zeitzone, explizite Umrechnung und DST-Testfälle | Zeitumstellungs-, Tagesgrenzen- und Exporttests | BP-03, BP-10 |
| R-10 | Backup existiert, ist aber nicht portabel oder nicht innerhalb von 30 Minuten wiederherstellbar. | M | kritisch | T-050, Q-ZUV-070 | D1 Time Travel plus geprüfter R2-Export, Prüfsumme, isolierter Restore, Runbook | Regelmäßiger zeitgemessener Restore-Test | BP-11, BP-12 |
| R-11 | Mobilfunk- oder Cloudflare-Ausfall verhindert den Betrieb; Wiedereinpflege aus Papier erzeugt Dubletten. | H | hoch | Q-ZUV-020, Q-ZUV-070, T-035 | Dual-SIM, letzter bestätigter Snapshot, Papierprozess, OQ-08, dedizierter Nacherfassungsablauf | Ausfallübung und vollständiger Abgleich | BP-09, BP-11, BP-12 |
| R-12 | D1-Abfragen skalieren nicht für fünf Jahre Historie. | M | hoch | Q-PER-020, F-HIS-010 | Indizes, paginierte Abfragen, Query-Budgets, Archiv-/Exportkonzept | realistische Volumen- und Query-Plan-Tests | BP-10, BP-12 |
| R-13 | Nicht hibernierende WebSockets oder Voll-Snapshots verursachen Kosten- und Stabilitätsprobleme. | M | mittel | Q-ZUV-010, Q-ZUV-030, Q-WAR-030, T-090 | Hibernation API, Versionscursor, begrenzte Snapshots, Polling-Fallback | Reconnect-/Langzeittest und Kostenmessung | BP-02, BP-12 |
| R-14 | Hinweise zu Gewicht, Zuladung, Kraftstoff oder Wetter werden als Sicherheitsfreigabe missverstanden. | M | kritisch | F-KAS-030, F-FLT-060, F-WET-010 | Neutrale Organisationssprache, keine Freigabeampel, fachliche Textabnahme | Rollenbasierter UI-Review | BP-04, BP-08, BP-12 |
| R-15 | Migration oder Konfigurationsänderung am Veranstaltungstag verursacht Stillstand. | M | hoch | F-ADM-020, T-070, T-080 | Change Freeze, Abnahmeumgebung, Backup, Rollback-/Restore-Notiz | Generalprobe und dokumentierter Rückfall | BP-10, BP-11 |
| R-16 | Cloudflare-Konto oder proprietäre Adapter erschweren Betreiberwechsel und Kontrolle. | N | hoch | Q-WAR-010, T-080 | Vereinsaccount, zwei Super-Admins, 2FA, portable Domain/SQL-Exporte, Adaptergrenzen | Übergabe- und Restore-Probe | BP-11 |

## ADR-Prüfung

- ADR-0001, ADR-0002 und ADR-0004 entsprechen den Anforderungen und den Architekturgrenzen.
- ADR-0003 ist nur mit offener Restfrage akzeptiert; OQ-06/R-06 müssen vor Produktionsfreigabe
  entschieden werden.
- ADR-0005 widerspricht den Anforderungen nicht, ist aber ohne OQ-01, OQ-02, OQ-08 und OQ-12 fachlich
  nicht vollständig genug für die Implementierung.
