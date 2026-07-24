# Abnahmenachweis: Admin- und Flight-Director-Oberfläche

- Konzept: `docs/ui/admin-flight-director-workspace-v1.md`
- Entscheidung: `docs/adr/0026-veranstaltungsbezogene-administration-und-stammdatenvorlagen.md`
- Anforderungen: F-ADM-060, F-ADM-080, Q-UX-020 und F-SLT-040
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
- `apps/web/src/admin-v15-ui.test.ts`: Navigation, Legacy-Links, Schritte, Diagramm und
  Importvorschau
- `apps/web/src/admin-v1-completion-ui.test.ts`: zentrierte Editoren, Tooltip-Auslösung,
  Rollenabgrenzung und Abschlusskorrektur
- `apps/web/src/flight-line-supervisor-ui.test.ts`: Kopfzeilenpriorität, Betriebsdialog,
  organisatorische Kommandos und Admin-only-Not-Halt-Aufhebung

## Browserabnahme

Am 24. Juli 2026 wurden nach erfolgreichem Build mit ausschließlich synthetischen Daten geprüft:

- Admin-Übersicht mit veranstaltungsbezogenem SVG-Diagramm
- Veranstaltungstabelle, alle acht Schritte, Suche, dreistufige Sortierung und Paginierung
- Stammdatentabellen ohne redundante Aktionsspalte; Zeilenklick öffnet den zentrierten Editor
- Modal-Fokusführung sowie Hilfetext nur über Hover, Fokus oder Klick des Info-Symbols
- Legacy-Links für `setup`, `master-data` und `audit`
- Admin/Betrieb ohne duplizierte Flotten- und Tanksteuerung
- Admin/Abschluss mit Bericht, Historie, Prognosegüte, Audit und Besetzungskorrektur
- Flight-Director-Kopf, Priorität des Betriebshinweises und alle vier Dialogtabs
- Hell/Dunkel auf Desktop, Tablet und 430 CSS-Pixel
- Browserkonsole ohne Warnungen oder Fehler

Der Importablauf einschließlich ungültiger und gültiger synthetischer Vorlagen ist durch die oben
genannten Contract-, Worker- und UI-Tests abgedeckt. In den Browserbildern waren keine Gastnamen,
öffentlichen Ticketcodes, PINs, Tokens oder Secrets sichtbar.
