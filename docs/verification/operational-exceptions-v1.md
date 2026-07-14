# Verifikation operative Sonderfälle V1

Stand: 14. Juli 2026

Betroffene Anforderungen: F-SLT-020, F-SLT-040, F-SLT-050, F-SLT-060, F-BRD-080, F-BRD-085 und
D-040.

## Umgesetzter Umfang

- Die Kasse zeigt bei übergroßen anonymen Gruppen die konkrete Aufteilung auf unmittelbar
  aufeinanderfolgende Fluggruppen. Der Verkauf wird erst nach einer ausdrücklichen Bestätigung
  freigegeben und übermittelt diese Bestätigung im Verkaufskommando.
- Flight Line und Flight-Line-Leitung können vollständige Ticketgruppen vor `IN_FLIGHT` in eine
  passende Fluggruppe verschieben. Quelle, Ziel, Grund und Abweichung vom Vorschlag werden
  append-only auditiert.
- Flight-Line-Leitung und Administration können die nutzbare Kapazität eines noch nicht
  aufgerufenen Umlaufs reduzieren. Nicht passende Gruppen werden ungeteilt an die vorderste
  passende Queue-Position gestellt.
- Nach Ablauf der konfigurierten Frist kann ein einzelnes, nicht eingechecktes Ticket anonym auf
  No-Show gesetzt werden. Vor Fristablauf wird das Kommando fachlich abgewiesen.
- Bei teilweiser Anwesenheit verlangt die Oberfläche eine bewusste und auditierte Entscheidung:
  mit den Anwesenden fliegen, den Platz leer lassen oder die gesamte Gruppe zurückstellen.
- Eine Nachbesetzung wird nur als Vorschlag angezeigt und erst durch eine weitere menschliche
  Aktion übernommen. Das System trennt Gruppen nicht automatisch.
- Betriebs- und Prognosehistorie stehen in der Administration mit deutschen Datums-/Zeitfiltern,
  fachlichen Filtern und stabiler Seitennavigation zur Verfügung.

## Automatisierte Nachweise

- Contract-Tests prüfen die anonymen Payloads `MARK_TICKET_NO_SHOW` und
  `CONFIRM_ATTENDANCE_DECISION`.
- Domain-Tests prüfen Rollen, No-Show-Frist, Anwesenheitszustand und Sperrpunkte.
- Worker-Integration prüft Queue-Gruppenschutz, bestätigte Aufteilung, Kapazitätsreduktion,
  Anwesenheitsentscheidung, Auditierung, Idempotenz, Versionskonflikte und die frühe
  No-Show-Abweisung.
- Audit-Coverage prüft die neuen Ereignistypen als append-only Nachweis.
- UI-Unit-Tests prüfen Aufteilungsvorschau, Gruppenkennzeichnung, zulässige Verschiebeziele,
  Anwesenheitszählung und den Nachbesetzungsvorschlag.

Ausgeführte fokussierte Prüfkette:

```text
npm run typecheck
npx vitest run apps/web/src/operational-exceptions.test.ts packages/contracts/src/index.test.ts packages/domain/src/index.test.ts apps/worker/src/audit-coverage.test.ts
npm run test:queue-grouping
```

## Browserprüfung

Die freigegebenen Oberflächen wurden mit synthetischen lokalen Daten geprüft:

- Kasse, Desktop 1600 px, Light Theme: Aufteilung `4 + 1`, Bestätigung und deaktivierte Aktion
  lesbar; kein horizontaler Seitenüberlauf.
- Flight Line, Desktop 1600 px, Dark Theme: kompakte Queue und rechte Dispositionsspalte stabil;
  kein horizontaler Seitenüberlauf.
- Flight Line, Mobil 430 px, Dark Theme: Disposition als Bottom-Sheet unter 85 dVh; kein
  horizontaler Seitenüberlauf.
- Administration, Mobil 430 px, Light Theme: alle drei Historien-Tabs vollständig sichtbar,
  deutsche 24-Stunden-Filter, 22 synthetische Betriebseinträge als lesbare Zeilenkarten; kein
  horizontaler Seitenüberlauf.

Der bevorzugte In-App-Browser war in dieser Sitzung wegen eines lokalen Kernel-Asset-Fehlers nicht
startfähig. Die gleiche visuelle Prüfung wurde deshalb mit Microsoft Edge über das Chrome DevTools
Protocol durchgeführt.

## Verbleibende Abgrenzung

F-SLT-040 ist auf Vertrags-, Rollen-, Datenbank- und Worker-Ebene vollständig geschützt: Änderungen
vor `IN_FLIGHT` laufen über die normale Disposition, danach ist dieser Pfad gesperrt. Der separate
Administrator-Korrekturpfad `CORRECT_ROTATION_MANIFEST` verlangt eine gültige PIN, verschiebt nur
vollständige anonyme Ticketgruppen und schreibt Ausgangs-/Zielumlauf, Begründung, Eventversion,
Kapazitätsabweichung und die fehlende Sicherheitsfreigabe append-only in Migration 0030 und Audit.
Der Integrationstest belegt Rollen- und PIN-Schutz, Idempotenz, stale-write-Ablehnung sowie den
Gruppenschutz. Die Bedienoberfläche für diesen seltenen Sonderfall bleibt Teil der noch ausstehenden
Administrationsabnahme; deshalb verbleibt die Traceability bis dahin auf `geplant`.
