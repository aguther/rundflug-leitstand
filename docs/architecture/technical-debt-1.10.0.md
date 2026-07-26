# Technische Schulden – Stand 1.10.0

Stand: 26. Juli 2026

Dieses Dokument ist die aktuelle, priorisierte Restschuldenliste. Erledigte Punkte aus früheren
Backlogs werden nicht weitergeführt; ihre fachlichen Ergebnisse stehen im kumulativen
Anforderungskatalog 1.10.0, in ADRs und in automatisierten Prüfungen.

## In 1.10.0 behoben

- Anwendung, Pakete, API-Metadaten, Backups, Anforderungen und Rollenblätter melden einheitlich
  Version 1.10.0.
- Der aktuelle Anforderungskatalog enthält alle 319 fortgeltenden Anforderungen mit vollständiger
  Traceability; konkurrierende textuelle Releasekopien wurden entfernt.
- Fünf illustrierte, reproduzierbare Rollenblätter decken Kasse, Flight Line, Flight Director, FIDS
  und Administration ab.
- Ein Cloudflare-Ziel kann namensgesteuert geplant, sicher wiederaufgenommen, aufgebaut und separat
  geprüft werden. D1-IDs müssen nicht mehr manuell in eine versionierte Konfiguration eingetragen
  werden.
- Der Werksreset prüft die aktuelle Administrator-PIN und führt im selben Browser über eine
  kurzlebige, einmal verwendbare und nicht durch JavaScript lesbare Fortsetzungsfreigabe direkt in
  die Ersteinrichtung.
- Größenbegrenzte JSON-Anfragen, der kanonische `/api/control`-Pfad, generierte Worker-Typen,
  automatisches Migrationsregister und Lockfile-basiertes Lizenzinventar sind abgesichert.
- Routenspezifische CSS- und Feature-Bundles reduzieren die globale Startlast.
- Reale Workers-Runtime-, DOM- und Browserprüfungen ergänzen die bestehenden Fach- und
  Integrationsprüfungen.

## Verbleibende Schulden

| Priorität | Befund | Nächster sicherer Schnitt |
|---|---|---|
| Hoch | `apps/worker/src/event-coordinator.ts` umfasst rund 7.700 Zeilen. | Kommandofamilien nacheinander in fachliche Handler extrahieren. Für jeden Schnitt zuerst Golden-Master-Tests für Idempotenz, erwartete Version, Audit, Outbox und Veröffentlichung nach Persistenz ergänzen. |
| Hoch | `apps/worker/src/index.ts` und `apps/web/src/admin-view.tsx` umfassen jeweils rund 5.800 bis 6.000 Zeilen. | Worker-Routen in Setup/Auth, Administration, operative Steuerung und Public/Push trennen; Admin-Teilflächen einzeln als Container, Hooks und Präsentationskomponenten herauslösen. |
| Mittel | Ein Teil älterer Tests prüft weiterhin Quelltextmerkmale statt beobachtbares Verhalten. | Bei jeder Änderung im betroffenen Bereich mindestens einen Quelltexttest durch einen Workers-Runtime-, DOM- oder Playwright-Test ersetzen; die Gesamtzahl in CI sichtbar machen. |
| Mittel | Der Produktionsabhängigkeitsbaum ist ohne bekannte hohe Schwachstelle, im Entwicklungsbaum verbleiben jedoch acht hohe Meldungen in der Workbox-Buildkette von `vite-plugin-pwa`. | Upstream-Releases beobachten und nur auf eine kompatible Version mit unverändertem Offline-/Installationsverhalten aktualisieren. Keine erzwungene, inkompatible Audit-Korrektur. |
| Mittel | Das globale CSS liegt trotz routenspezifischer Auslagerung noch bei rund 156 KiB; einzelne JavaScript-Chunks bleiben groß. | Pro Rollenroute weitere Stil- und Featuregrenzen ziehen und Größenbudgets in den Build aufnehmen. |
| Niedrig | Historisch existiert die Migrationsnummer `0036` zweimal. Die Dateien sind bereits angewandt und dürfen nicht umbenannt werden. | Das automatisch erzeugte Migrationsregister und die Eindeutigkeitsprüfung beibehalten; neue Migrationen ausschließlich mit der nächsten freien Nummer anlegen. |

## Leitplanken

Die verbleibende Modularisierung ist bewusst inkrementell. Kein Dateigrößenziel rechtfertigt eine
Änderung an Gruppenschutz, Autorisierung, Idempotenz, Concurrency, Auditierung, atomarer
Persistenzgrenze oder öffentlicher Datenminimierung. Jede Extraktion muss die bestehenden
fachlichen Tests und die vollständige Prüfkette bestehen.
