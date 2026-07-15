# ADR-0007: Eine Cloudflare-Abnahmeumgebung bis zur Produktionsfreigabe

- Status: Akzeptiert
- Datum: 2026-07-11
- Betroffene Anforderung: T-070

## Kontext

Die Anwendung befindet sich vor der V1-Produktionsfreigabe. Mehrere Wrangler-Umgebungsblöcke und
unterschiedliche Branch-Zuordnungen erschwerten den frühen Cloudflare-Aufbau, ohne in dieser Phase
einen zusätzlichen fachlichen Schutz zu liefern. Der Auftraggeber hat deshalb entschieden, bis auf
Weiteres auf `main` und mit genau einer zentralen Cloudflare-Abnahmeumgebung zu arbeiten. Lokale
Entwicklung und automatisierte Tests bleiben davon technisch getrennt.

## Entscheidung

- `main` ist bis zur Produktionsfreigabe der einzige Cloudflare-Deployment-Branch.
- `wrangler.jsonc` enthält vorerst keine getrennten `env.dev`-/`env.production`-Blöcke.
- Die gebundene zentrale Umgebung ist ausdrücklich eine **Abnahmeumgebung**. `APP_ENV` bleibt dort
  auf `acceptance`.
- Es werden ausschließlich synthetische beziehungsweise für die Abnahme freigegebene anonyme IDs
  verwendet. Ein echter Veranstaltungsbetrieb ist in dieser Umgebung nicht freigegeben.
- Lokale D1-/Durable-Object-/R2-Zustände bleiben über Wrangler-Persistenzpfade von der zentralen
  Umgebung getrennt.

## Abweichung zu T-070

Diese Entscheidung erfüllt T-070 nicht. Die Anforderung bleibt in der Traceability auf `geplant`,
bis eine technisch und organisatorisch getrennte Produktivumgebung abgenommen ist. Die Abweichung
ist für die Vorproduktionsphase ausdrücklich akzeptiert, darf aber nicht stillschweigend in den
Produktionsbetrieb übernommen werden.

## Verbindliches Produktions-Gate

Vor der ersten Nutzung mit echten Veranstaltungsdaten beziehungsweise am realen Flugtag müssen:

1. eine separate D1-Datenbank, ein separater EU-R2-Bucket und ein separates Durable-Object-Namespace
   für Produktion angelegt werden,
2. getrennte Secret-Sätze für Bootstrap, Administrator-PIN, VAPID und CI/CD erzeugt werden,
3. eine separate Worker-Route oder Domain und ein eindeutiges `APP_ENV=production` eingerichtet
   werden,
4. Migration, Setup, Rollen-Smoke-Test, Backup/Restore und Rollback in der Produktionsumgebung
   nachgewiesen werden,
5. die Abnahmeumgebung weiterhin unabhängig deploy- und rücksetzbar bleiben,
6. T-070 erst nach dokumentierter Prüfung in der Traceability auf `umgesetzt` gesetzt werden.

Die Umstellung ist ein eigener freizugebender Betriebsschritt. Sie wird nicht nebenbei durch einen
Feature-Commit oder eine automatische Cloudflare-Buildkonfiguration vorgenommen.

## Folgen

Der aktuelle Aufbau bleibt für Entwicklung und V1-Abnahme einfach und reproduzierbar. Zugleich ist
sichtbar, dass die vorhandene Cloudflare-Instanz keine Produktivfreigabe besitzt. Ein späterer
Umgebungswechsel benötigt neue Ressourcen und Secrets, aber keine Änderung der Fachlogik.
