# Einheitlicher Veranstaltungsarbeitsbereich der Administration

Status: freigegeben zur Umsetzung  
Stand: 01.08.2026

## Ziel

Die veranstaltungsbezogene Administration verwendet in allen neun Schritten denselben visuellen und
interaktiven Rahmen. Der bestehende Schritt „Veranstaltung“ ist die Referenz für Kontext, Hierarchie,
Typografie und Bedienungsdichte. Die Schritte Gates, Ressourcengruppen, Flugzeuge, Pilotencodes,
Produkte, Betriebsplan, Betrieb und Abschluss werden in diesen Rahmen überführt. Die bestehende
zweigeteilte Kassenansicht bleibt unabhängig davon in ihrer Grundstruktur erhalten: links „Tickets
verkaufen“, rechts Ticketliste, Detail, Druck und Storno. Nur die rechte Hälfte erhält die nachfolgend
beschriebenen Verkäuferfilter und -kennungen.

Grundlage sind der freigegebene Auftrag „Veranstaltungsbezogene Administration vollständig
vereinheitlichen“ und das am 01.08.2026 freigegebene „Kassen- und Admin-Feedbackdelta“. Eine weitere
Konzeptfreigabe ist nicht erforderlich.

## Gestaltungs- und Interaktionssystem

- Der globale Seitentitel und die neunstufige Navigation bleiben außerhalb des scrollenden
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
- Gate- und Produkteditoren verwenden direkt unter ihrer Legende eine horizontale Tabzeile über die
  volle Dialogbreite. Tooltip-Overlays verändern weder Dialogbreite noch Scrollmaße; der Dialogbody
  reserviert seine Scrollbarbreite dauerhaft.

## Fachliche Oberflächen

- Gates bleiben eine Tabelle; der Editor trennt Grunddaten und öffentliche Anzeige.
- Ressourcengruppen werden auf breiten Viewports als zweispaltige, in der Höhe begrenzte Karten
  dargestellt. Flugzeugmitgliedschaften werden ausschließlich über den historisierten
  Einzelzuordnungsdialog geändert. Eine Auswahl führt noch keine Änderung aus und muss deshalb beim
  Schließen nicht verworfen werden. Erst „Zuordnung bestätigen“ sendet den bestehenden Command;
  unmittelbar zuvor und serverseitig wird die Zuordnung erneut geprüft.
- Flugzeuge und Pilotencodes bleiben kompakte Tabellen. Operative Zustände werden lesend und getrennt
  von Stammdatenstatus dargestellt.
- Produkte zeigen ihr Zeitmodell in der Übersicht. Der kompakte Editor trennt allgemeine Daten und
  Planung; ausgesetzte Gewichts- und Kinderbegleitfelder bleiben unsichtbar. Eine eigene Zeilenaktion
  öffnet die produktbezogene Verkaufssteuerung. Verkaufsschluss und Live-Freigabe werden dort abhängig
  vom Veranstaltungsstatus bedient; die übrigen Verkaufseinstellungen bleiben unverändert.
- Produktweite Bodenphasen zeigen wirksamen Wert und Quelle. Flugzeug-Produkt-Abweichungen werden in
  genau einem gemeinsamen Beziehungsdialog aus Flugzeug- und Produktkontext bearbeitet.
- Betriebsplan ist ein optionaler eigener Schritt zwischen Produkte und Betrieb. Er trennt
  „Einschränkungen“ und „Wiederkehrende Regeln“, zählt aber nicht zu den Voraussetzungen der
  Betriebsfreigabe.
- Betrieb zeigt nur Betriebsfreigabe beziehungsweise Betriebsende und den getrennt bestätigten
  Notfallmodus. Produktverkauf und Kapazität werden dort nicht zusätzlich dargestellt.
- Abschluss gliedert sich in Tagesübersicht, Betriebshistorie, Prognosegüte, Auditprotokoll und den
  violett gekennzeichneten administrativen Korrekturweg.

## Kasse und Verkäuferzuordnung

- App-Header, Größenverhältnis und Bedienung der linken Hälfte „Tickets verkaufen“ bleiben
  unverändert. Auch auf schmaleren Viewports verändern die neuen Filter nur die rechte Hälfte.
- Die vorhandene Suchleiste der rechten Hälfte wird um „Kassenkonto“ und „Nur meine Tickets“ ergänzt.
  Statusreiter, Suche, Nachladen, manuelle Aktualisierung und Realtime-Revalidierung verwenden
  denselben serverseitigen Filterzustand.
- Ticketliste und ausgewähltes Ticketdetail zeigen die anonyme Kassenkennung. Historische Bestände und
  Papierimporte ohne Zuordnung werden als „Nicht zugeordnet“ dargestellt.
- Die Verkäuferzuordnung regulärer Verkäufe stammt ausschließlich aus dem vertrauenswürdigen
  Operator-Kontext des Workers. Öffentliche Ticket-, QR-, Druck- und Statusverträge erhalten keine
  Kontokennung.

## Freigegebenes UI-Finish

- In der Kassen-Ticketwerkzeugleiste verwenden Suche, Kassenkonto, „Nur meine Tickets“ und manuelles
  Aktualisieren dieselbe Touch-Control-Höhe und eine gemeinsame Control-Achse.
- Der lokale Verkaufsschluss übernimmt den horizontalen Textabstand der Zeitfelder aus dem
  Veranstaltungsschritt; der reservierte Bereich für Kalender- und Uhrsymbol bleibt stabil.
- Beide Betriebsplan-Tabs besitzen denselben umlaufenden Inhaltsabstand. Pro Tab gibt es genau eine
  blaue Primäraktion im Kopf. Einschränkungen und wiederkehrende Regeln verwenden gleichwertige,
  aktionsfreie Leerzustände. Beide Köpfe zeigen die Zahl der aktiven Einträge; wiederkehrende Regeln
  verwenden wie Einschränkungen eine Tabelle mit dauerhaft sichtbarem Spaltenkopf. Die Primäraktion
  des Regel-Tabs heißt kurz „Regel hinzufügen“.
- Betriebsfreigabe und Notfallmodus stehen in gleich breiten und gleich hohen neutralen Außenkarten.
  Nur Grundfeld und Not-Halt-Aktion liegen in einer rot gekennzeichneten Innenfläche; die rote
  Semantik wird nicht auf die gesamte Kartenhälfte ausgedehnt.

## Verbindliche Fachgrenzen

- Ressourcengruppenzuordnungen verwenden ausschließlich `ASSIGN_AIRCRAFT_RESOURCE_GROUP`; eine
  Aufhebung oder Batchzuordnung wird nicht ergänzt.
- Der Bestätigungsbutton der Einzelzuordnung wird aktiv, sobald die ausgewählte Kombination nach dem
  aktuell geladenen Board vollständig, gültig und als Zuordnung möglich ist. Erst seine Betätigung
  führt den Command aus; zwischenzeitliche Konflikte bleiben eine serverseitige Ablehnung.
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

- F-KAS-090, F-KAS-120: serverseitige Ticketsuche und anonyme Kassenbedienung
- F-KAP-030, F-KAP-040, F-KAP-050, F-KAP-060: Produktverkauf, Kapazität und Verkaufssteuerung
- F-ADM-020, F-ADM-030, F-ADM-050, F-ADM-060, F-ADM-080: Veranstaltung, Administration,
  Betrieb und Vorlagen
- F-INT-070: geschützte Übergabe des angemeldeten Operator-Kontexts
- F-RES-040, F-RES-050: eindeutige und historisierte Flugzeugmitgliedschaft
- F-SLT-040: geschützte Besetzung nach Flugbeginn und dokumentierter Admin-Korrekturweg
- D-060, D-090: technische Nachvollziehbarkeit und Datenhaltung
- V16-KAS-030, V18-CAS-010, V19-CAS-010: fortgeltende Kassen- und Bedienungsdeltas
- Q-UX-010, Q-UX-020, Q-UX-040: Touch-Bedienung, kompakte Tabellen und konsistente Statusdarstellung
- ADR-0031: Hierarchie der Turnaround-Phasen

Die Browserabnahme und die ausgeführten Prüfungen werden in
`docs/verification/admin-flight-director-workspace-v1.md` ergänzt.
