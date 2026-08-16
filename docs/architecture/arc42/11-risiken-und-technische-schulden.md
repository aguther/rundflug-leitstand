# 11. Risiken und technische Schulden

## 11.1 Architekturrisiken

Das vollständige, bewertete Register mit 21 Einträgen, Gegenmaßnahmen und Nachweisen steht in
[`docs/risks.md`](../../risks.md). Die für die Architektur wichtigsten Risiken:

| ID | Risiko | Bewertung | Architektonische Gegenmaßnahme |
| --- | --- | --- | --- |
| R-01 | Parallele oder wiederholte Kommandos erzeugen doppelte Tickets, Umläufe oder Zustandswechsel | hoch / kritisch | Serialisierung je Veranstaltung, `commandId`, `expectedVersion`, atomarer Idempotenzbeleg |
| R-02 | Ereignisprotokoll, relationale Projektion, Idempotenzbeleg und Outbox laufen auseinander | mittel / kritisch | eine gemeinsame Persistenzgrenze, Veröffentlichung erst nach Commit, Fehlerinjektionstests |
| R-03 | Offline-Kommandos überschreiben neuere Zustände | hoch / kritisch | operative Kommandos nur online, sichtbare Konfliktauflösung, keine automatische Zusammenführung |
| R-04 | Flugzeug, Ticket oder Pilot wird mehrfach gebunden | mittel / kritisch | Domäneninvarianten plus partielle Unique-Indizes und transaktionale Prüfung |
| R-05 | Öffentliche Codes erratbar oder sensible Daten in Antworten und Logs | niedrig / kritisch | serverseitige kryptografische Vergabe, gruppen- und ticketübergreifende Kollisionsprüfung, Hash-Lookup, minimale DTOs, Rate Limits, Log-Redaktion |
| R-06 | EU-Verarbeitung erfüllt die Anforderung formal nicht | mittel / kritisch | EU-Jurisdiktion für D1, R2 und DO; abschließende rechtliche Bewertung offen (OQ-06) |
| R-08 | Prognose überschreitet zwei Sekunden oder wirkt scheinpräzise | mittel / hoch | deterministisches Modell, begrenzter Optimierungshorizont, Unsicherheitsstufen, Lastbudget |
| R-10 | Sicherung ist nicht portabel oder nicht in 30 Minuten wiederherstellbar | mittel / kritisch | portabler R2-Export mit Prüfsumme, D1 Time Travel, geprüfter isolierter Restore |
| R-11 | Verbindungsausfall stoppt den Betrieb, Nacherfassung erzeugt Dubletten | hoch / hoch | letzter bestätigter Snapshot, Papierprozess, Vier-Augen-Nacherfassung mit Konfliktprüfung |
| R-13 | Nicht hibernierende WebSockets verursachen Kosten- und Stabilitätsprobleme | mittel / mittel | Hibernation-API, Versionssignal statt Datenverteilung, Polling-Fallback |
| R-17 | Analyseexporte legen Codes, Push-Ziele oder Credentials offen | mittel / kritisch | typisierte `SUPPORT_SAFE`-Allowlist, ereignistypspezifische Redaktion, private R2-Objekte |
| R-12 | D1-Abfragen skalieren nicht für mehrtägige und fünfjährige Planungshistorie | mittel / hoch | 24-Stunden-Heißfenster, verifizierte R2-Segmente, begrenztes Pruning, vollständiger Restore- und Lastnachweis |

Produktionsblockierend bleiben R-06 (OQ-06) und die vollständige V1-Abnahme gemäß ADR-0007.

## 11.2 Technische Schulden

Das aktuelle, themenbezogene Register liegt unter
[`docs/architecture/technical-debts/`](../technical-debts/README.md). Die Konsolidierung 1.11 → 1.12
hat die früher dominierenden Monolithen aufgelöst:

| Kennzahl | Ausgangsstand | Stand 1.12.0 |
| --- | ---: | ---: |
| `apps/worker/src/event-coordinator.ts` | 12.571 Zeilen | 721 Zeilen |
| `apps/worker/src/index.ts` | 8.277 Zeilen | 202 Zeilen |
| `apps/web/src/admin-view.tsx` | 5.546 Zeilen | 656 Zeilen |
| `packages/contracts/src/index.ts` | 3.793 Zeilen | 8 Zeilen |
| `packages/contracts/src/operations-dispatch.ts` | 1.293 Zeilen | 65 Zeilen; Fassade vor Familienmodulen mit höchstens 440 Zeilen |
| `apps/web/.../forecast-simulation/engine.ts` | 1.513 Zeilen | 213 Zeilen |
| `apps/web/.../forecast-simulation/operational-engine.ts` | 1.490 Zeilen | 338 Zeilen |
| Dependency-Audit | 13 High, 2 Moderate | 0 Findings |

Verbleibende, bewusst priorisierte Schulden:

| Priorität | Thema | Nächster geplanter Schnitt |
| --- | --- | --- |
| Mittel | [Mutationstest-Aussagekraft](../technical-debts/mutation-test-effectiveness.md) | überlebende Mutanten nach fachlichem Risiko priorisieren und Ratchets ausschließlich anheben |
| Mittel | [Worker-SQL-Testorakel](../technical-debts/worker-sql-test-oracles.md) | elf Priorität-A-Familien auf ausgeführtes SQLite-, Runtime-, HTTP- oder E2E-Verhalten migrieren |
| Mittel | [Worker-Orchestrierung](../technical-debts/worker-orchestration-complexity.md) | entitätsspezifische Entscheidungs- und Persistenzpläne isolieren |

Die Online-Pflicht der Administration und der inkompatible V1.12-Baseline-Neuaufbau sind bewusste
Architektur- beziehungsweise Rolloutentscheidungen und werden nicht als technische Schulden geführt.

Die vormals getrennten lokalen Simulationsengines sind durch eine operative Pipeline ersetzt. Presets
werden an der Engine-Grenze in eine synthetische operative Topologie übersetzt, importierte Modelle
direkt übernommen. Gemeinsame deterministische Primitive und Golden-Seed-Tests verhindern Drift;
die Operational-Tests werden nicht aus dem Coverage-Lauf ausgeschlossen.

Die Rollenrouten sind dünne Shells. Der historische globale Flight-Line-Layer ist entfernt; Flight
Line, Flight Director, Administration, Kasse und Analytics besitzen getrennte CSS-Grenzen. Native
React-/SVG-Zeitreihen ersetzen Recharts. Online-only Administration, Simulation, Vergleich und
Verlaufsanalyse bleiben außerhalb des PWA-Precache. Der Abschlussnachweis misst 82,75 KiB globale
CSS, 42,38 KiB Flight-Line-CSS, 184,02 KiB für den größten JavaScript-Chunk und 1.220,04 KiB
PWA-Precache. Unveränderte Hard Limits besitzen mindestens zehn Prozent Pflichtreserve; die
abgesenkte Baseline erlaubt pro Route weiterhin höchstens zwei Prozent Wachstum. Damit ist die
Web-Asset-Spielraum-Schuld geschlossen; ADR-0055 und QS-21 verhindern eine stille Rückverlagerung.

Der Operations-Contract ist in vier Command-Familien sowie getrennte Board- und Assistance-Module
zerlegt; Exhaustiveness- und Subpath-Tests schützen die kompatible Fassade. Produktive Domain-Module
besitzen keine Rückimporte aus dem eigenen Barrel. Die neun zuvor fest verdrahteten lokalen
Worker-Verifier verwenden einen gemeinsamen, pro Lauf isolierten Port-, D1- und Assets-Lebenszyklus.

Die frühere Kopplung von Tests an produktive Quelltexte ist vollständig entfernt. Guardrails halten
Rohimporte, Dateisystem-Lesezugriffe auf `.ts`, `.tsx`, `.js` und `.mjs` sowie literale Python-Zugriffe
bei null. Availability-, Soak- und Remote-Performance-Harness führen injizierbare Szenariomodule aus;
Backup-Exporter und Python-Restore teilen einen validierten JSON-Tabellenvertrag. Datenbanktests führen
die produktive Baseline in SQLite aus. Der getrennte SQL-Audit klassifiziert 36 Worker-Testfamilien:
25 besitzen zusätzliche Behavior-Evidence, elf Priorität-A-Familien bleiben offen. Coverage belegt
Ausführung, der fokussierte Stryker-Lauf die Wirksamkeit ausgewählter Assertions; beide ersetzen den
SQL-Verhaltensnachweis nicht. Details dokumentieren ADR-0046 und der Nachweis
`docs/verification/behavioral-test-quality-2026-08-15.md`.

## 11.3 Leitplanken für weitere Umbauten

Kein Größen-, Testkopplungs- oder Performanceziel rechtfertigt Änderungen an Gruppenschutz,
Autorisierung, Idempotenz, erwarteter Version, Nebenläufigkeitsprüfung, Auditierung, Outbox,
atomarer Persistenzgrenze, öffentlicher Datenminimierung oder der Reihenfolge fachlich sichtbarer
Ereignisse. D1 bleibt relationale Source of Truth; die Realtime-Veröffentlichung erfolgt weiterhin
erst nach erfolgreicher Persistenz.
