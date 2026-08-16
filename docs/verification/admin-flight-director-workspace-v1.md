# Abnahmenachweis: Admin- und Flight-Director-Oberfläche

- Aktuelles Konzept: `docs/ui/v1.11.0-release-concept.md`
- Entscheidung: `docs/architecture/adr/0026-veranstaltungsbezogene-administration-und-stammdatenvorlagen.md`
- Anforderungen: F-ADM-020, F-ADM-060, F-ADM-080, F-ADM-120, F-FLT-090,
  Q-UX-010, Q-UX-020, Q-UX-040 und F-SLT-040
- Testdaten: ausschließlich synthetisch

## Automatisierte Nachweise

- `packages/domain/src/operational-note-role.test.ts` und
  `apps/worker/src/operational-note-permission.test.ts`: Rollen, stale-write-Prüfung, Audit,
  Idempotenz und Outbox für `SET_OPERATIONAL_NOTE`
- `packages/contracts/src/master-data-template.test.ts`: striktes Format, unbekannte Daten,
  Dubletten und Referenzen
- `apps/worker/src/admin-master-data-template.test.ts`: Admin-Schutz, leeres Ziel,
  transaktionaler Idempotenz-Guard, Audit und Outbox
- `apps/worker/src/admin-event-flow.test.ts`: kumulative Verkäufe und Abschlüsse, leere Zeiträume,
  Zeitzonen/DST und adaptive Intervalle
- `apps/worker/src/planned-operation-audit-reason.test.ts` und
  `apps/worker/src/operational-planning.test.ts`: rollen- und aktionsbezogene Auditgründe,
  abgelehnte Browser-Gründe und privater Betriebsplan ohne internes Grundfeld
- `apps/web/src/admin-view.dom.test.tsx`, `apps/web/src/admin-ux.dom.test.tsx` und
  `apps/web/src/features/admin/AdminEventFlowChart.dom.test.tsx`: Navigation, zugängliche
  Arbeitsbereiche, Diagramm und Nutzerinteraktion
- `apps/web/src/features/admin/operations/OperationsWorkspace.dom.test.tsx` und
  `apps/web/src/features/admin/AdminShellDialogs.dom.test.tsx`: segmentierte Arbeitsbereiche,
  Betriebsplantabelle, rollenabhängige Bestätigung und Kontendialoge
- `apps/worker/src/operator-account-management.test.ts`: Admin-Schutz, Sitzungswiderruf und
  geschütztes Löschen von Konten; eigene und letzte aktive Administrationskonten bleiben erhalten
- `apps/web/src/features/admin/completion/CompletionWorkspace.dom.test.tsx` und
  `apps/web/src/features/admin/completion/ManifestCorrectionPanel.dom.test.tsx`: Rollenabgrenzung,
  Abschlusskorrektur und zugängliche Interaktion
- `apps/web/src/flight-line-supervisor-ui.test.ts`: Kopfzeilenpriorität, Betriebsdialog,
  organisatorische Kommandos und Admin-only-Not-Halt-Aufhebung

## Browserabnahme

Am 26. Juli 2026 wurden nach erfolgreichem Build mit ausschließlich synthetischen Daten geprüft;
die ergänzende Prüfung der automatisch erzeugten Betriebsplan-Auditgründe erfolgte am 27. Juli
2026:

- Admin-Übersicht mit veranstaltungsbezogenem SVG-Diagramm
- Veranstaltungstabelle im Verwaltungsdialog sowie alle acht kompakten, per Tastatur bedienbaren
  Schritte mit festem Statusplatz
- Stammdatentabellen mit expliziten Stift-/Löschen-Aktionen, Suche, Leerzuständen und zentrierten
  Editoren
- Kontentabelle mit Hinzufügen-/Bearbeiten-/Löschen-Dialogen; ein synthetisch angelegtes Testkonto
  wurde gelöscht und verschwand aus Anmeldung und Verwaltung
- Modal-Fokusführung sowie Hilfetext nur über Hover, Fokus oder Klick des Info-Symbols
- Legacy-Links für `setup`, `master-data` und `audit`
- gemeinsamer Betriebsplan in Admin und Flight Director; nur der Flight Director erhält
  Start-/Endbestätigung
- Erstellen-/Bearbeiten-Dialog des Betriebsplans ohne sichtbaren oder bearbeitbaren internen Grund;
  der Worker ergänzt den Auditgrund aus authentifizierter Rolle und Aktion
- Admin/Abschluss mit Bericht, Historie, Prognosegüte, Audit und Besetzungskorrektur
- Flight-Director-Kopf, Priorität des Betriebshinweises und alle vier Dialogtabs
- Hell/Dunkel sowie Layouts bei 1440 × 1024, 1194 × 834 und 834 × 1194 CSS-Pixel
- keine horizontale Seitenverschiebung; 44–48-px-Aktionsflächen und begrenzt hohe,
  intern scrollende Modale
- Browserkonsole ohne Warnungen oder Fehler

Der Importablauf einschließlich ungültiger und gültiger synthetischer Vorlagen ist durch die oben
genannten Contract-, Worker- und UI-Tests abgedeckt. In den Browserbildern waren keine Gastnamen,
öffentlichen Ticketcodes, PINs, Tokens oder Secrets sichtbar.
