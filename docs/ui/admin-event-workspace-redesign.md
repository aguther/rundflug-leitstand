# Einheitlicher Veranstaltungsarbeitsbereich der Administration

Status: freigegeben zur Umsetzung  
Stand: 31.07.2026

## Ziel

Die veranstaltungsbezogene Administration verwendet in allen acht Schritten denselben visuellen und
interaktiven Rahmen. Der bestehende Schritt „Veranstaltung“ ist die Referenz für Kontext, Hierarchie,
Typografie und Bedienungsdichte. Die Schritte Gates, Ressourcengruppen, Flugzeuge, Pilotencodes,
Produkte, Betrieb und Abschluss werden in diesen Rahmen überführt, ohne fachliche Zuständigkeiten oder
persistierte Verträge zu verändern.

Grundlage ist der freigegebene Auftrag „Veranstaltungsbezogene Administration vollständig
vereinheitlichen“. Eine weitere Konzeptfreigabe ist nicht erforderlich.

## Gestaltungs- und Interaktionssystem

- Der globale Seitentitel und die achtstufige Navigation bleiben außerhalb des scrollenden
  Schrittinhalts stabil.
- Jeder Schritt beginnt mit demselben kompakten Veranstaltungskontext: Name, Status, Datum,
  Flugplatz und Zeitzone aus dem `OperationBoard`.
- Formularinhalte sind auf 1180 px, Stammdaten auf 1520 px sowie Betrieb und Abschluss auf 1640 px
  begrenzt. Kleine Viewports nutzen die gesamte verfügbare Breite.
- Stammdaten verwenden eine gemeinsame Werkzeugleiste, eindeutige Leerzustände, kontrollierte
  Sortierung und Paginierung. Breite Listen besitzen genau einen internen horizontalen Scrollbereich.
- Dialoge behalten einen festen Kopf und Fuß; nur der Body scrollt. Speichern, Abbrechen und
  irreversible Aktionen sind räumlich getrennt, Dirty-State und Fokus werden geschützt.
- Blau kennzeichnet Auswahl und Primäraktion, Grün Erfolg beziehungsweise aktiven Zustand, Amber
  Einschränkungen, Rot Gefahr und Violett administrative Sonderwege. Ausschließlich vorhandene
  Design-Tokens werden verwendet.
- Tabs besitzen vollständige `tablist`-/`tab`-/`tabpanel`-Semantik und unterstützen Pfeiltasten,
  `Home` und `End`.

## Fachliche Oberflächen

- Gates bleiben eine Tabelle; der Editor trennt Grunddaten und öffentliche Anzeige.
- Ressourcengruppen werden auf breiten Viewports als zweispaltige, in der Höhe begrenzte Karten
  dargestellt. Flugzeugmitgliedschaften werden ausschließlich über den historisierten
  Zuordnungsdialog geändert.
- Flugzeuge und Pilotencodes bleiben kompakte Tabellen. Operative Zustände werden lesend und getrennt
  von Stammdatenstatus dargestellt.
- Produkte zeigen ihr Zeitmodell in der Übersicht. Der kompakte Editor trennt allgemeine Daten und
  Planung; ausgesetzte Gewichts- und Kinderbegleitfelder bleiben unsichtbar.
- Produktweite Bodenphasen zeigen wirksamen Wert und Quelle. Flugzeug-Produkt-Abweichungen werden in
  genau einem gemeinsamen Beziehungsdialog aus Flugzeug- und Produktkontext bearbeitet.
- Betrieb gliedert sich in „Plan und Freigabe“, „Verkauf und Kapazität“ sowie „Sonderlagen“.
- Abschluss gliedert sich in Tagesübersicht, Betriebshistorie, Prognosegüte, Auditprotokoll und den
  violett gekennzeichneten administrativen Korrekturweg.

## Verbindliche Fachgrenzen

- Ressourcengruppenzuordnungen verwenden ausschließlich `ASSIGN_AIRCRAFT_RESOURCE_GROUP`; eine
  Aufhebung oder Batchzuordnung wird nicht ergänzt.
- Die Zeitauflösung folgt ADR-0031 komponentenweise: Flugzeug + Produkt vor Produkt vor Veranstaltung.
  Offblock–Onblock bleibt ausschließlich am Produkt.
- `null` bedeutet Vererbung; ein expliziter Wert `0` bleibt unterscheidbar.
- Admin-Oberflächen führen keine Flight-Director-Bestätigungen, Sicherheitsentscheidungen oder
  Freigaben aus. Versteckte operative Flotten-, Piloten-, Queue- und Hinweissteuerungen bleiben
  verborgen.
- Commands behalten erwartete Versionen, Idempotenz, Berechtigungsprüfung und append-only Auditierung.
- Im Kern und in sichtbaren Eingaben werden keine Gastnamen, Pilotennamen, Lizenz- oder Kontaktdaten
  eingeführt.

## Nachweisbezug

- F-ADM-020: Veranstaltungsstammdaten und direkte Ressourcengruppenbeziehungen
- F-ADM-060: kompakte administrative Übersicht bei operativer Zuständigkeit des Flight Directors
- F-ADM-080: veranstaltungsbezogene Administration und Vorlagen
- F-RES-040, F-RES-050: eindeutige und historisierte Flugzeugmitgliedschaft
- F-SLT-040: geschützte Besetzung nach Flugbeginn und dokumentierter Admin-Korrekturweg
- Q-UX-010, Q-UX-020, Q-UX-040: Touch-Bedienung, kompakte Tabellen und konsistente Statusdarstellung
- ADR-0031: Hierarchie der Turnaround-Phasen

Die Browserabnahme und die ausgeführten Prüfungen werden in
`docs/verification/admin-flight-director-workspace-v1.md` ergänzt.
