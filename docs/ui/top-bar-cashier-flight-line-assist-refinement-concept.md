# UI-Feinkonzept: Top-Leiste, Kasse, Flight Line und Assist

- Status: freigegeben am 2026-07-22 durch den Auftraggeber
- Datum: 2026-07-22
- Betroffene Anforderungen: V17-KAS-010, V17-TKT-010, V17-UI-020, V17-UI-030,
  V17-UI-040, V17-FL-010, V17-FL-020, V17-FL-030, V17-UI-050
- Fortgeltende Entscheidungen: ADR-0018, ADR-0019, ADR-0020

Dieses Konzept verfeinert die bestehenden V1.7-/V1.7.1-Oberflächen. Farben, Typografie,
semantische Statusfarben, Ein-Bildschirm-Abläufe, Rollen, Fachzustände, Druckbild und das
zugrunde liegende Designsystem werden nicht neu gestaltet. FIDS ist von den Änderungen an der
Top-Leiste ausdrücklich ausgenommen.

## 1. Gemeinsame Top-Leiste der internen Ansichten

### Aufbau

```text
[Logo] Veranstaltungsname                    [● Verbunden] [aktuelle Sicht] [Benutzer ▾]
```

- Das Logo und der Veranstaltungsname bilden links eine statische Kennzeichnung. Sie sind in den
  internen Ansichten kein Link und lösen keinen Sprung zur Kasse aus.
- Der Ansichtswechsler bleibt eine quadratische 40-Pixel-Schaltfläche. Er zeigt ausschließlich das
  Symbol der tatsächlich aktiven Sicht: Kasse, Flight Line, Assist oder Administration. FIDS
  behält seine bestehende eigene Kopfzeilenbehandlung.
- Das Symbol sitzt in einem eigenen, optisch zentrierten Icon-Container. Nur ein tatsächlich
  vorhandener Chevron darf gedreht werden; das Sichtensymbol selbst verändert beim Öffnen weder
  Ausrichtung noch Position.
- Der Verbindungsindikator steht vor dem Ansichtswechsler. Auf Desktop zeigt er Punkt und Text, auf
  kleinen Mobilgeräten nur den Punkt; die Reihenfolge bleibt auf allen Breakpoints identisch.
- Der Indikator unterscheidet `Prüfen`, `Verbunden`, `Gestört` und `Offline`. Ein wiederhergestellter
  Cache oder der Zustand von `navigator.onLine` allein darf keine bestätigte Backendverbindung
  vortäuschen.
- Veranstaltungsauswahl, Darstellung, Produktinformation und Abmeldung werden im Benutzermenü
  gebündelt. Separate Kalender-, Info- und Theme-Schaltflächen entfallen.

### Benutzermenü

```text
ADMIN-01
Administrator
────────────────────────
📅 Veranstaltung wechseln
   Rundflug 2026

Darstellung
(•) System   ( ) Hell   ( ) Dunkel

ⓘ Über Rundflug-Leitstand
────────────────────────
↪ Abmelden
```

- Das Menü ist auf Desktop höchstens etwa 320 Pixel breit. Es zeigt Icons und klare Texte; der
  aktive Darstellungsmodus ist als echte Radioauswahl erkennbar und nicht nur aus einem wechselnden
  Symbol abzuleiten.
- Auf Mobilgeräten bleibt dieselbe Informationsarchitektur erhalten. Das Menü wird mit sicheren
  seitlichen Abständen viewportbezogen positioniert, ist bei 320 CSS-Pixel vollständig sichtbar
  und scrollt nur dann intern, wenn die verfügbare Höhe nicht ausreicht.
- Beschriftungen bleiben auch mobil erhalten. Sekundärtext wird kompakter gesetzt und darf
  umbrechen; zentrale Aktionen werden nicht zu schwer verständlichen Icon-only-Zeilen reduziert.
- Jede Menüaktion ist mindestens 44 Pixel hoch. Fokus, Escape, Außenklick und Light-/Dark-Theme
  werden vollständig unterstützt.
- „Veranstaltung wechseln“ zeigt den aktuellen Veranstaltungsnamen als Sekundärtext und führt in
  die bestehende Veranstaltungsauswahl zurück.
- „Über Rundflug-Leitstand“ schließt das Menü und öffnet einen kompakten modalen Dialog. Der Dialog
  enthält Produktname und Version und lässt sich über Schließen-Schaltfläche, Escape und
  Hintergrund schließen. Fokus wird beim Schließen an den Auslöser zurückgegeben.

### Zustände und Prüfungen

- Für jede interne Route wird die Icon-Zuordnung automatisiert geprüft, insbesondere die getrennten
  Pfade `/flight-line` und `/flight-line/assist` sowie Unterpfade der Administration.
- Die Standardadresse wird nach der angemeldeten Rolle kanonisch weitergeleitet: Kasse zu `/kasse`,
  Flight Line zu `/flight-line/assist`, Supervisor zu `/flight-line` und Administration zu
  `/admin`. FIDS behält seinen direkten öffentlichen Einstieg.
- Geöffnetes Ansichts- oder Benutzermenü verändert das Sichtensymbol nicht.
- Auf Desktop bleibt der Login-Code sichtbar; auf sehr schmalen Geräten genügt im Header das
  Benutzersymbol, während das geöffnete Menü weiterhin Code und Rolle nennt.

## 2. Kasse

### Stabile Verkaufsaktion

- Die Verkaufsspalte erhält je Breakpoint eine feste Breite. Alle Produktzeilen verwenden dadurch
  im selben Viewport exakt gleich breite Schaltflächen, unabhängig von Ticketzahl, Produktpreis,
  Gesamtbetrag oder Ladebeschriftung.
- Zahlen verwenden tabellarische Ziffern. Sehr lange Beträge dürfen kontrolliert innerhalb der
  festen Schaltfläche umbrechen, verändern aber weder Spalten- noch Schaltflächenbreite.
- Die vorhandene Beschriftung mit Ticketzahl und Gesamtbetrag bleibt erhalten; auf kleinen
  Mobilgeräten bleibt mindestens die vollständige, zugänglich benannte Verkaufsaktion erreichbar.

### Auswahl ohne Toast

- Die Auswahl einer verkauften Buchungsgruppe wird ausschließlich durch die markierte Tabellenzeile
  und den unmittelbar aktualisierten Detailbereich bestätigt.
- Das Nachladen des zugehörigen Ticketzettels erzeugt ebenfalls keinen Erfolgstoast.
- Fachliche Erfolge wie ein abgeschlossener Verkauf oder ein Storno sowie Fehler bleiben über den
  bestehenden Meldungskanal sichtbar. Reine Navigation und Auswahl erzeugen keine Meldung.

### Ticketvorschau

- Die vollständige Vorschau nutzt den vorhandenen Bereich deutlich besser aus. Der Zettel wächst
  bis auf ungefähr 260 CSS-Pixel Breite und wird nur reduziert, wenn die Spalte diese Breite
  tatsächlich nicht bereitstellt. Er bleibt vollständig und ohne eigenen Scrollbereich sichtbar.
- QR-Code und Beschriftungen wachsen proportional innerhalb der Bildschirmvorschau. Das
  unveränderte 58-mm-Druckdokument bleibt davon getrennt.
- Der Veranstaltungsname ist die Titelzeile des Zettels; die generische Beschriftung
  „Rundflug-Leitstand“ entfällt.
- Die Aktion zum Öffnen des Scan-Dialogs zeigt nur noch das Vergrößerungssymbol. Sie behält einen
  eindeutigen zugänglichen Namen und Tooltip und erfüllt auf Touchgeräten ein 44-Pixel-Touchziel.

## 3. Flight Line – Supervisor

### Flugzeugtabelle

- Die blaue Zeilenauswahl und der linke Auswahlbalken entfallen vollständig. Flugzeugzeilen zeigen
  nur fachliche Statusfarben in Status, Zeitlinie und aktiver Aktion.
- Das Kennzeichen ist keine funktionslose Auswahlschaltfläche mehr. Aktionen wählen das betroffene
  Flugzeug intern weiterhin unmittelbar vor dem jeweiligen Dialog oder Kommando aus, ohne einen
  dauerhaften visuellen Auswahlzustand zu erzeugen.
- Das `UserPen`-Symbol für Pilotenzuweisung/-wechsel wird in seiner nativen aufrechten Orientierung
  dargestellt. Allgemeine Zeilen-CSS darf keine Aktionssymbole drehen.
- Der Pilotencode und die Pilotwechselaktion belegen getrennte Rasterspalten. Dadurch stehen alle
  Pilotwechselaktionen unabhängig von der Länge des Pilotencodes exakt untereinander.

### Verkaufte Tickets

Der Kopf wird auf Desktop in einer kompakten Zeile angeordnet:

```text
Verkaufte Tickets · alle Flugzeuge    [Suche …]  [ ] Nur offene Tickets
```

- Die Suche erhält eine begrenzte Breite, statt die komplette Panelbreite zu belegen.
- „Nur offene Tickets“ ist eine echte Checkbox und standardmäßig deaktiviert. Aktiviert blendet sie
  abgeschlossene Umläufe aus; Suche und Checkbox wirken gemeinsam.
- Jeder Spaltenkopf ist eine dreistufige Sortieraktion: aufsteigend, absteigend und anschließend
  wieder Standardsortierung. Fehlende Werte stehen in beiden Richtungen am Ende; bei Gleichstand
  gilt weiterhin die stabile Standardsortierung nach Verkaufszeit und ID.
- Die Tabelle zeigt folgende Spalten:

```text
Ticketgruppe | Personen | Umlaufstatus | Flugzeug | Produkt | Zeitfenster |
Boarding | Off-Block | On-Block | Abschluss
```

- Zeitfenster wird für noch nicht Off-Block gegangene Umläufe als prognostizierte Spanne in Minuten
  dargestellt. Danach steht dort ein Gedankenstrich. Die vier Ereignisspalten zeigen bestätigte
  Ist-Zeiten im Veranstaltungstimezone-Format oder einen Gedankenstrich.
- Der Tabellenkopf bleibt innerhalb des Ticketbereichs stehen. Bei zu geringer Breite scrollt nur
  die Tabelle horizontal; die Seite selbst erhält keinen horizontalen Überlauf.
- Zwischen `On-Block` und `Nicht verfügbar` wird keine Verbindungslinie gezeichnet. Nicht verfügbar
  bleibt ein eigenständiger Folgezustand nach dem Turnaround.
- Der Zuweisungsdialog zeigt keine redundante Bestätigung des bereits zugeordneten Piloten. Ein
  notwendiger Hinweis auf einen fehlenden Piloten bleibt erhalten.

### Nicht verfügbar bei aktivem Umlauf

- Die Aktion „Nicht verfügbar“ ist bei `AVAILABLE` sowie in Boarding (`CALLED`) und Off-Block
  (`IN_FLIGHT`) bedienbar.
- Bei Boarding oder Off-Block öffnet sie den bereits vorhandenen Pflichtgrunddialog. Erst nach
  Bestätigung wird das erwartungsversionierte und idempotente Kommando ausgeführt.
- Der Dialog erklärt ausdrücklich: Alle vollständigen verbundenen Gruppen werden als stabiler Block
  ganz vorne in die Queue zurückgestellt; das Flugzeug wird nicht verfügbar.
- Fehler und stale writes bleiben sichtbar. Es gibt keine automatische Bestätigung oder
  sicherheitsbezogene Freigabesemantik.

## 4. Flight Line – Assist

### Feste Arbeitsbereiche

Die Arbeitsansicht besteht aus drei klar getrennten Panels:

```text
┌ Flugzeugkopf: Kennzeichen · Status · Zeit · Pilot      [Freigeben] ┐
└─────────────────────────────────────────────────────────────────────┘
┌ Zustandsaktionen: [Primär] [Tanken] [Pause] [Nicht verfügbar]      ┐
└─────────────────────────────────────────────────────────────────────┘
┌ [Aktueller Umlauf] [Historie]                                      ┐
│ Tabinhalt                                                          │
└─────────────────────────────────────────────────────────────────────┘
```

- Flugzeugkopf und Zustandsaktionen liegen außerhalb des Tab-Scrollbereichs und scrollen niemals
  gemeinsam mit Historieneinträgen.
- „Flugzeug freigeben“ sitzt oben rechts im Flugzeugkopf. Desktop und Tablet zeigen Icon und Text;
  auf schmalen iPhones darf die Schaltfläche bei unverändertem zugänglichem Namen auf ein
  44-Pixel-Icon reduziert werden. Die bisherige zusätzliche Freigabeaktion am Ende der
  Gruppenauswahl entfällt.
- Pilotencode und berechtigter Pilotwechsel bleiben im Flugzeugkopf. Auf schmalen Geräten dürfen sie
  in eine zweite Kopfzeile umbrechen, ohne die Freigabeaktion von oben rechts zu verdrängen.
- Primäraktion, Tanken, Pause und Nicht verfügbar bilden ein eigenes, geometrisch stabiles Panel.
  Sie bleiben bei Tabwechsel und Historien-Scroll sichtbar.

### Aktueller Umlauf und Historie

- „Aktueller Umlauf“ besitzt keinen eigenen Scrollbalken. Status, Buchungsgruppen, Pilot und die
  vollständige gemeinsame Ist-Zeitlinie bestimmen die natürliche Höhe des Tabpanels.
- Diese natürliche Höhe des aktuellen Umlaufs bleibt auch bei aktivem Historien-Tab erhalten.
  Historieneinträge verwenden genau diesen verfügbaren Bereich und erhalten nur bei mehr Inhalt
  einen vertikalen Scrollbalken.
- Auf Mobilgeräten wird der aktuelle Umlauf responsiv gestapelt; kein Zeitlinienlabel und kein
  Touchziel erzeugt horizontalen Dokumentüberlauf.
- Die bisher dauerhaft sichtbare Gruppenauswahl entfällt. Die Primäraktion öffnet denselben modalen
  Zuweisungsdialog wie die Supervisor-Sicht; Auswahl, Anwesenheit, Nachrufen und Zurückstellen bleiben
  im Dialog verfügbar, ohne den Ein-Bildschirm-Ablauf zu verlängern.
- Auch in Assist endet die gezeichnete Zeitlinie bei `On-Block`; zu `Nicht verfügbar` besteht keine
  Verbindungslinie.

### Nicht verfügbar bei aktivem Umlauf

- Assist verwendet dieselbe Freigabelogik wie der Supervisor: Bei Boarding und Off-Block ist
  „Nicht verfügbar“ aktiv und öffnet den gemeinsamen Pflichtgrunddialog zur Rückstellung an den
  Queue-Anfang.
- Tanken und Pause behalten ihre bisherigen Zustandsregeln. Die Erweiterung gilt gezielt für
  „Nicht verfügbar“ und schwächt keine andere Zustandsinvariante ab.

## 5. Responsive- und Browserabnahme

- Top-Leiste und Menüs: 320×568, 390×844, 430×932, 1024×768, 1366×768 und 1600×980, jeweils Light
  und Dark; zusätzlich Tastaturbedienung, Escape, Außenklick und lange Veranstaltungs-/Logintexte.
- Kasse: 834×1112, 1024×768, 1194×679, 1366×768 und 1600×980 mit mindestens drei Produkten,
  Ticketmengen 1 und 12, kurzen und langen Preisen, ausgewählter Buchungsgruppe und Scan-Dialog.
- Supervisor: 1024×768, 1366×768 und 1536×1024 mit langer Ticketliste, offenem Filter, allen
  Ereigniszeitspalten sowie Boarding-/Off-Block-Abbruchdialog.
- Assist: 320×568, 390×844, 430×932, 768×1024, 1024×768 und 1536×1024. Aktueller Umlauf bleibt
  ohne inneren Scrollbalken vollständig; lange Historie scrollt bei identischer Panelhöhe;
  Flugzeugkopf, Aktionen und Freigabe bleiben außerhalb dieses Scrollbereichs.
- Der Ablauf `Boarding oder Off-Block → Nicht verfügbar → Pflichtgrund → vollständige Gruppen ganz
  vorne in der Queue → Flugzeug inaktiv` wird für Supervisor und Assist geprüft. Abbruch, Fehler,
  stale write und unveränderter Zustand ohne Bestätigung werden ebenfalls geprüft.
- FIDS, öffentliches Ticketstatusbild und 58-mm-Drucklayout werden auf unbeabsichtigte Regressionen
  kontrolliert, aber nicht umgestaltet.

## 6. Technischer Änderungsrahmen

- Erwartet werden Änderungen an `AppHeader`, Theme-Menü/-zustand, Kassenansicht und -CSS,
  Supervisor-/Assist-Komponenten, gemeinsamen Flight-Line-Bausteinen sowie ihren UI-Tests.
- Für die Rückstellung bei aktivem Umlauf werden keine neuen Contracts, Domainregeln, Worker-Routen
  oder Datenbankmigrationen benötigt. Das bestehende Kommando
  `ABORT_ROTATION_TO_QUEUE_AND_MARK_AIRCRAFT_UNAVAILABLE` bleibt die einzige Ausführung.
- Der Entwurf ändert keine Rollenberechtigung, Idempotenz-, Versions-, Audit- oder Outbox-Grenze.

## 7. Freigegebene iPad- und Queue-Ergänzung

- Die Supervisor-Flugzeugzeile bleibt auch auf dem iPad einzeilig. Für Tabletbreiten bis 1180
  CSS-Pixel
  entfallen das Personen-Icon vor dem Pilotencode und unnötige Spaltenbreite; Pilotencode,
  Pilotwechsel, Buchungsgruppen, Zeitlinie und fünf 44-Pixel-Aktionen bleiben erhalten.
- Die einzeilige Flugzeugliste wird ab 1024 CSS-Pixel ohne horizontalen Scroll abgenommen; auf
  schmaleren Supervisor-Ansichten bleiben alle Inhalte erreichbar.
- „Buchungsgruppen“ darf im Tabellenkopf zweizeilig stehen. Der letzte Zeitlinienschritt wird auf
  Tabletbreite sichtbar als „Nicht verf.“ abgekürzt; der zugängliche Name bleibt „Nicht verfügbar“.
- Die Aktionsicons im Supervisor erhalten denselben sichtbaren Rahmen und Kontrollhintergrund wie
  in Assist. Reine Touchgeräte übernehmen nach einer Zustandsänderung keinen stehenbleibenden
  Hover-Zustand.
- Die verkaufte Ticketliste erhält nach „Ticketgruppe“ die sortierbare Spalte „Queue“. Aktuell
  wartende Gruppen zeigen Ressourcengruppenname und `queueSequence`, zum Beispiel `Panorama · 3`;
  nicht mehr wartende Gruppen zeigen einen Gedankenstrich und stehen bei Sortierung am Ende.
- `queueSequence` ist eine operative Reihenfolge innerhalb einer Ressourcengruppe und unabhängig
  von der stabilen Kommunikationsnummer. Die Spalte „Ticketgruppe“ sortiert deshalb separat rein
  numerisch nach `communicationNumber`, ohne Produktpräfix.
- Das Ansichtsmenü wird rechts am Auslöser und innerhalb des Viewports verankert. Auf Mobilgeräten
  bilden Verbindungspunkt, Ansichtswechsel und Benutzerkonto wie auf Desktop eine gemeinsame rechte
  Kontrollgruppe.
- Die Gruppenaktionen im gemeinsamen Zuweisungsdialog sind 44-Pixel-Iconbuttons rechts neben
  Checkbox und Gruppenkennung. Anwesend, Nicht da, Nachrufen und – in Assist – Zurückstellen behalten
  vollständige zugängliche Namen und Tooltips; Personen- und Anwesenheitszahlen stehen darunter.

## Freigabeentscheidung

Dieses Dokument ist die freigegebene visuelle und interaktive Spezifikation für die anschließende
Implementierung und Browserabnahme.

## 8. Freigegebene Korrekturen vom 22. Juli 2026

- Die Kasse erzeugt beim bloßen Öffnen und während der ersten Serverbestätigung keinen
  Offline-Entwurf. Nur eine bewusste lokale Änderung während eines echten Verbindungsfehlers oder
  die Bearbeitung eines bereits vorhandenen V2-Entwurfs wird gespeichert und gemeldet.
- Die Supervisor-Zeile verzichtet auf das Flugzeugsymbol. Unter der Sitzplatzzahl steht das stabile,
  administrierbare Ressourcengruppen-Kurzzeichen; der Langname bleibt als Zusatzinformation
  verfügbar. Der Pilotwechsel besitzt keinen wiederholenden Spaltentext.
- Auf Tabletbreite lautet der letzte Zeitlinienschritt sichtbar „Nicht verf.“. Tanken ist ab
  Off-Block gesperrt, während „Nicht verfügbar“ den technischen Pflichtgrund-Abbruch weiterhin
  anbietet.
- Zurückstellen ist im gemeinsamen Zuweisungsdialog für Assist und Supervisor identisch vorhanden.
  Auf reinen Touchgeräten bleibt kein Hover-Farbzustand zurück; nur ein tatsächlich aktiver,
  gedrückter Zustand bleibt farblich markiert.
- Die Administration verwendet ohne eigene Geometrie-Overrides dieselbe Top-Leiste wie die übrigen
  internen Sichten.
- Der technische Abbruch verschiebt vor der Rückstellung sämtliche historischen und aktuellen
  Queue-Sequenzen in einen kollisionsfreien Bereich. Rückstellung, Umlaufreset, Flugzeugstatus,
  Audit, Idempotenzbeleg und Outbox bleiben Bestandteil desselben D1-Batches.
