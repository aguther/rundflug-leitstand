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

Produktionsblockierend bleiben R-06 (OQ-06) und die vollständige V1-Abnahme gemäß ADR-0007.

## 11.2 Technische Schulden

Das aktuelle, themenbezogene Register liegt unter
[`docs/architecture/technical-debts/`](../technical-debts/README.md). Die Konsolidierung 1.11 → 1.12
hat die früher dominierenden Monolithen aufgelöst:

| Kennzahl | Ausgangsstand | Stand 1.12.0 |
| --- | ---: | ---: |
| `apps/worker/src/event-coordinator.ts` | 12.571 Zeilen | 721 Zeilen |
| `apps/worker/src/index.ts` | 8.277 Zeilen | 195 Zeilen |
| `apps/web/src/admin-view.tsx` | 5.546 Zeilen | 656 Zeilen |
| `packages/contracts/src/index.ts` | 3.793 Zeilen | 8 Zeilen |
| `packages/contracts/src/operations-dispatch.ts` | 1.293 Zeilen | 65 Zeilen; Fassade vor Familienmodulen mit höchstens 440 Zeilen |
| `apps/web/.../forecast-simulation/engine.ts` | 1.513 Zeilen | 213 Zeilen |
| `apps/web/.../forecast-simulation/operational-engine.ts` | 1.490 Zeilen | 338 Zeilen |
| Dependency-Audit | 13 High, 2 Moderate | 0 Findings |

Verbleibende, bewusst priorisierte Schulden:

| Priorität | Thema | Nächster geplanter Schnitt |
| --- | --- | --- |
| Mittel | [Legacy-Prognosepfad](../technical-debts/forecast-legacy-comparison-path.md) | Abschaltkriterien aus ADR-0041 erfüllen; keine neuen Fachregeln im Legacy-Pfad ergänzen |
| Mittel | [Mutationstest-Aussagekraft](../technical-debts/mutation-test-effectiveness.md) | überlebende Mutanten nach fachlichem Risiko priorisieren und Ratchets ausschließlich anheben |
| Mittel | [Worker-Orchestrierung](../technical-debts/worker-orchestration-complexity.md) | entitätsspezifische Entscheidungs- und Persistenzpläne isolieren |
| Mittel | [Web-Asset-Spielraum](../technical-debts/web-asset-budget-headroom.md) | rollenbezogene Grenzen weiter absenken und keine globale Rückverlagerung zulassen |

Die Online-Pflicht der Administration und der inkompatible V1.12-Baseline-Neuaufbau sind bewusste
Architektur- beziehungsweise Rolloutentscheidungen und werden nicht als technische Schulden geführt.

Die vormals monolithischen lokalen Simulationsengines sind in Szenario-, Lifecycle-, Forecast-,
Precall-, Dispatch-, Snapshot- und Metrikmodule zerlegt. Gemeinsame deterministische Primitive und
Golden-Seed-Tests verhindern Drift; die Operational-Tests werden nicht mehr aus dem Coverage-Lauf
ausgeschlossen. Größenratchets schützen die erreichten Orchestratorgrenzen.

Die Rollenrouten sind nun 6 bis 11 Zeilen große Shells. `CashierWorkspace.tsx` liegt bei 228 Zeilen,
`FlightLineWorkspace.tsx` bei 466 Zeilen; alle daraus neu extrahierten Komponenten und Hooks bleiben
unter 300 Zeilen. Der historische globale Flight-Line-Layer ist entfernt; Flight Line und Flight
Director besitzen getrennte CSS-Chunks. Ausschließlich online nutzbare Administrations-, Simulator-
und Verlaufsanalyse-Chunks werden nicht vorab im PWA-Precache gespeichert. Der aktuelle Nachweis misst
93,87 KiB globale CSS, 72,41 KiB Flight-Line-CSS, 313,48 KiB für den größten JavaScript-Chunk und
1.289,35 KiB PWA-Precache. Die Ratchets erlauben höchstens zwei Prozent Wachstum, ohne die
vereinbarten harten Obergrenzen zu überschreiten.

Der Operations-Contract ist in vier Command-Familien sowie getrennte Board- und Assistance-Module
zerlegt; Exhaustiveness- und Subpath-Tests schützen die kompatible Fassade. Produktive Domain-Module
besitzen keine Rückimporte aus dem eigenen Barrel. Die neun zuvor fest verdrahteten lokalen
Worker-Verifier verwenden einen gemeinsamen, pro Lauf isolierten Port-, D1- und Assets-Lebenszyklus.

Die frühere Kopplung von Tests an produktive TypeScript-Quelltexte ist vollständig entfernt. Guardrails
halten rohe Importe und Dateisystem-Lesezugriffe auf `.ts`/`.tsx` bei null. Datenbanktests führen die
produktive Baseline in SQLite aus; globale und kritische Domain-Coverage-Ratchets sowie der fokussierte
Stryker-Lauf sichern die Verhaltensaussage zusätzlich ab. Details dokumentieren ADR-0046 und der
Nachweis `docs/verification/behavioral-test-quality-2026-08-15.md`.

## 11.3 Leitplanken für weitere Umbauten

Kein Größen-, Testkopplungs- oder Performanceziel rechtfertigt Änderungen an Gruppenschutz,
Autorisierung, Idempotenz, erwarteter Version, Nebenläufigkeitsprüfung, Auditierung, Outbox,
atomarer Persistenzgrenze, öffentlicher Datenminimierung oder der Reihenfolge fachlich sichtbarer
Ereignisse. D1 bleibt relationale Source of Truth; die Realtime-Veröffentlichung erfolgt weiterhin
erst nach erfolgreicher Persistenz.
