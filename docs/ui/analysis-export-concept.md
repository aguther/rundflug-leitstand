# UI-Konzept: Analyse und Diagnose

Status: Entwurf zur ausdrücklichen Freigabe gemäß OQ-19

Stand: 02.08.2026

Betroffene Rollen: Administration und Flight Director

Betroffene Anforderungen: V1120-DIA-010, V1120-DIA-030, V1120-EXP-010,
V1120-SEC-010, V1120-OPS-010 und V1120-QA-010

Vor der Freigabe dieses Dokuments wird kein UI-Code aus WP2 oder WP3 implementiert.

## Ziel und Leitidee

Ein berechtigter Benutzer kann den aktuellen support-sicheren Diagnosezustand herunterladen. Nach
dem Schließen eines Veranstaltungstags kann die Administration zusätzlich unveränderliche
Tagesanalysepakete erstellen, deren Zustand verfolgen, sie herunterladen und löschen.

Die Oberfläche kommuniziert drei Grenzen jederzeit klar:

1. Eine Momentaufnahme beschreibt einen bestätigten technischen Stand, keine flugbetriebliche
   Freigabe.
2. Das Datenschutzprofil lautet ausschließlich **Support-sicher**.
3. Ein vollständiges Tagespaket entsteht erst nach dem Schließen oder Archivieren des Tags.

Die bestehende Ein-Bildschirm-Bedienung von Kasse, Flight Line und Flight Director bleibt
unverändert. Insbesondere erhält keine Flugzeugzeile eine neue Primäraktion.

## Informationsarchitektur

### Administration

Der vorhandene Hauptbereich **Auswertung** erhält innerhalb seines stabilen Inhaltsrahmens zwei
Tabs:

- **Analyse und Diagnose**
- **Prognose-Simulator**

`Analyse und Diagnose` ist der erste und initial aktive Tab. Der vorhandene Simulatorinhalt wird
ohne funktionale Änderung in den zweiten Tab verschoben. Der globale Seitentitel, die linke
Administrationsnavigation und der aktuell gewählte Veranstaltungskontext bleiben beim Tabwechsel
an derselben Position.

Die Analyseansicht bezieht sich immer auf die in der Administration ausgewählte Veranstaltung. Ist
keine Veranstaltung gewählt, erscheint statt einer leeren Tabelle genau ein kompakter
Leerzustand mit der Aktion **Veranstaltung auswählen**. Es gibt keinen globalen, eventübergreifenden
Archivdump.

### Flight Director

Die Flight-Director-Kopfaktion **Auswertungen** bleibt erhalten. Direkt daneben liegt als
sekundäre, unaufdringliche Icon-Aktion mit Downloadsymbol **Diagnose-Momentaufnahme**. Sie besitzt
einen festen Aktionsslot, eine dauerhaft reservierte Breite und den zugänglichen Namen
`Support-sichere Diagnose-Momentaufnahme herunterladen`.

Die Aktion erscheint nur für `FLIGHT_DIRECTOR` und `ADMIN`. Sie ist keine Primäraktion, wird nicht
in Flugzeug- oder Gruppenzeilen dupliziert und verändert keine Auswahl oder operative Aktion.

Im bereits geöffneten Belegungsdialog erscheint dieselbe Diagnoseaktion rechts im festen
Dialogkopf vor der Schließen-Aktion. Damit lässt sich gerade der fehlerverdächtige lokale
Auswahlzustand erfassen. Der Dialog schließt nicht, kein Formwert wird verändert und der Fokus kehrt
nach dem Download auf die Diagnoseaktion zurück.

## Administrationsoberfläche

### Ein-Bildschirm-Aufbau

```text
┌ Auswertung ───────────────────────────────────────────────────────────────┐
│ [Analyse und Diagnose] [Prognose-Simulator]                              │
├ Veranstaltung · Status · Datum · Zeitzone ───────────────────────────────┤
│ Diagnose-Momentaufnahme                          [Momentaufnahme export.] │
│ Support-sicher · aktueller Board- und Planungsstand                      │
│ reservierte Status-/Fehlerzeile                                          │
├ Tagesanalysepakete ──────────────────────────────────────────────────────┤
│ Vollständige Pakete sind erst bei CLOSED/ARCHIVED möglich. [Erstellen]   │
│ ┌ begrenzter Tabellen-Scrollbereich ───────────────────────────────────┐ │
│ │ Erstellt │ Event-Version │ Größe │ Ablauf │ Status │ feste Aktionen │ │
│ │ …                                                                  │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

Der Momentaufnahmebereich ist eine kompakte Werkzeugzeile und keine Dashboardkarte. Darunter folgt
die Archivliste als Hauptinhalt. Der Gesamtscreen bleibt bei 1366 × 768 und 1440 × 900 ohne
vermeidbaren Scroll; allein der Tabellenkörper besitzt bei vielen Archiven einen begrenzten
vertikalen Scrollbereich. Auf Tabletbreite darf der Tabellenrahmen genau einen eigenen horizontalen
Scrollbereich erhalten.

### Diagnose-Momentaufnahme

Die Werkzeugzeile zeigt:

- Titel `Diagnose-Momentaufnahme`,
- Kennzeichen `Support-sicher`,
- knappe Erklärung `Aktueller Betriebs- und Planungsstand für die technische Analyse`,
- Aktion **Aktuelle Momentaufnahme exportieren**,
- eine dauerhaft reservierte einzeilige Statusfläche darunter.

Die Aktion ist während `PREPARATION`, `ACTIVE`, `CLOSED` und `ARCHIVED` verfügbar, sofern ein zur
aktuellen Veranstaltungsversion passender erfolgreicher Planungslauf existiert. Der Browser sendet
die sichtbare Event-Version als Erwartungswert. Bei einem Versionskonflikt bleibt die Werkzeugzeile
stehen; die Statusfläche zeigt:

`Der Betriebsstand hat sich geändert. Ansicht aktualisieren und Export erneut starten.`

Daneben erscheint die sekundäre Aktion **Aktualisieren**. Es erfolgt kein automatischer Download
eines möglicherweise gemischten Stands.

Während des Abrufs behält der Button Text, Breite und Position. Ein mittiger Spinner ergänzt den
Text visuell; `aria-busy=true` und die reservierte Statusfläche vermitteln den Zustand. Nach Erfolg
lautet die nicht fokussierbare Statusmeldung `Momentaufnahme wurde heruntergeladen.` und
verschwindet nach angemessener Zeit. Erwartete Erfolgsabläufe erzeugen keinen globalen Toast.

### Tagesanalysepakete

Oberhalb der Liste steht links die Erklärung, rechts ein fester Aktionsslot:

- `ACTIVE` oder `PREPARATION`: deaktivierte Aktion **Nach Tagesschluss erstellen** und sichtbarer
  Hinweis `Vollständige Tagespakete sind erst nach dem Schließen des Tags verfügbar.`
- `CLOSED` oder `ARCHIVED` ohne Archiv: **Tagespaket erstellen**.
- vorhandenes `PENDING`, `BUILDING` oder `READY` derselben Event-Version: keine zweite Erstellen-
  Aktion; der Slot zeigt die passende Statusaktion beziehungsweise bleibt größenstabil reserviert.
- `FAILED`: **Erneut versuchen**.

Die Liste sortiert neueste Quellversion und Erstellzeit absteigend. Spalten:

| Spalte | Inhalt |
| --- | --- |
| Erstellt | lokale Veranstaltungszeit, zusätzlich vollständiger ISO-Zeitpunkt zugänglich |
| Event-Version | numerische Quellversion |
| Größe | formatierte Bytegröße oder reservierter Gedankenstrich |
| Ablauf | lokales Datum/Zeit oder `Gelöscht` |
| Status | Text plus Symbol; Farbe nie allein |
| Aktionen | feste Spaltenbreite und größenstabile Buttons |

Sichtbare Statusbegriffe:

| Technisch | Sichtbar | Aktion |
| --- | --- | --- |
| `PENDING` | Wird vorbereitet | keine |
| `BUILDING` | Wird erstellt | keine |
| `READY` | Bereit | Herunterladen, Löschen |
| `FAILED` | Fehlgeschlagen | Erneut versuchen |
| `EXPIRED` | Abgelaufen | keine |
| `DELETED` | Gelöscht | keine |

Die Aktionsspalte reserviert Platz für zwei kompakte Controls. Pending-, Fehler- und Ready-Wechsel
ändern weder Spaltenbreite noch Tabellenkopfposition. Der Status aktualisiert sich über die
vorhandene Realtime-/Polling-Koordination; ein veralteter Poll darf keinen neueren Status
überschreiben.

**Herunterladen** prüft serverseitig erneut Rolle und `READY`, schreibt das getrennte
Analysezugriffsereignis und streamt die Datei ohne öffentliche URL. Der Button bleibt während des
Starts busy; danach übernimmt der Browserdownload.

**Löschen** öffnet einen kompakten `alertdialog` mit Event-Datum, Event-Version und dem Hinweis:

`Das Tagespaket wird aus dem Analysespeicher gelöscht. Der Lösch- und Zugriffsverlauf bleibt zur
Nachvollziehbarkeit erhalten.`

Der Fokus startet auf **Abbrechen**. Die destruktive Aktion **Tagespaket löschen** ist räumlich
getrennt und rot. Nach Erfolg bleibt die Zeile als `Gelöscht` ohne Downloadaktion sichtbar.

## Sichere Clientdiagnose

Der Browser ergänzt die validierte Serverdatei ausschließlich um folgende Felder:

```text
capturedAt
route
selectedAircraftId
selectedRotationId
selectedQueueGroupIds
assignmentDialogOpen
visibleRecommendation.planRevision
visibleRecommendation.batchId
visibleRecommendation.groupIds
connectionState
viewport.width / height / devicePixelRatio
displayMode
browserFamily / browserMajorVersion
recentUiEvents
```

Der lokale Ringpuffer lebt nur im Arbeitsspeicher, ist nach Reload leer und enthält höchstens 100
Einträge. Zulässige technische Ereignisse:

```text
AIRCRAFT_SELECTED
ASSIGNMENT_DIALOG_OPENED
DISPATCH_RECOMMENDATION_APPLIED
QUEUE_GROUP_SELECTION_CHANGED
ASSIGNMENT_DIALOG_CLOSED
ANALYSIS_EXPORT_STARTED
ANALYSIS_EXPORT_COMPLETED
ANALYSIS_EXPORT_FAILED
```

Ereignisse enthalten nur Zeitpunkt, festen Ereignistyp und die für diesen Typ definierte kleine
Payload. Die Gruppenauswahl verwendet interne Gruppen-IDs; sie enthält keine Ticket-IDs oder
öffentlichen Codes.

Verboten sind insbesondere:

- Cookies, Sessionobjekt und Web-Storage-Dump,
- Konto-ID, Login-Code, Geräte-ID oder Gerätetoken,
- PIN, Setup- oder Push-Credential,
- freie Eingaben und Abweichungsgründe,
- vollständiger User Agent, Netzwerkadresse oder Fehlerstack,
- öffentliche Ticket-/Gruppencodes und deren Hashes,
- Notizen, Einzelgewichte oder Zahlungsfelder.

### Geöffneter Belegungsdialog

Bei Export aus dem geöffneten Dialog werden genau diese lokalen Zustände erfasst:

- `assignmentDialogOpen: true`,
- ausgewählte technische Flugzeug- und Umlauf-ID,
- intern ausgewählte Ticketgruppen-IDs,
- getrennt davon die aktuell sichtbare Dispatch-Empfehlung.

Nicht erfasst werden ein noch nicht bestätigter Freitextgrund, Sitzungsdaten, der gesamte
Dialogzustand oder DOM-/HTML-Inhalt. Der Export friert keine Empfehlung ein und bestätigt keine
Belegung. Während des Downloads bleiben Auswahl, Scrollposition und Fokus erhalten.

## Lade-, Leer-, Fehler- und Pending-Zustände

### Initiales Laden

Tabzeile, Eventkontext, Werkzeugzeile, Tabellenkopf und Aktionsspalte werden sofort in ihrer finalen
Geometrie gerendert. Im Tabellenkörper erscheinen höchstens fünf zeilenförmige Skeletons mit festen
Höhen. Es gibt keine ganzflächige Spinnerkarte.

### Leere Liste

Der Tabellenkopf bleibt sichtbar. Eine einzelne Tabellenzeile über alle Spalten enthält:

`Für diese Veranstaltung wurde noch kein Tagesanalysepaket erstellt.`

Bei geschlossenem Tag steht die Erstellen-Aktion weiterhin im festen Kopfslot; der Leerzustand
selbst besitzt keine zweite Aktion.

### Ladefehler

Board und zuletzt bestätigte Archivliste bleiben sichtbar und werden mit `Stand möglicherweise
veraltet` gekennzeichnet. Die reservierte Statusfläche zeigt einen kurzen sicheren Fehlertext und
**Erneut laden**. Technische Rohfehler und Stacks erscheinen nicht.

### Erstellfehler

Die Tabellenzeile bleibt bestehen. Status `Fehlgeschlagen`, Zeitpunkt des letzten Versuchs und ein
fester sicherer Fehlercode sind zugänglich; eine rohe Provider- oder SQL-Fehlermeldung wird weder
angezeigt noch heruntergeladen. **Erneut versuchen** verwendet denselben logischen Archivdatensatz.

### Verbindungsausfall

Momentaufnahme und mutierende Archivaktionen sind gesperrt, solange die aktuelle Event-Version
nicht sicher bestätigt ist. Die letzte bestätigte Liste bleibt mit Alter und Verbindungsstatus
sichtbar. Ein Offline-Klick wird nicht als gestarteter Export oder Archivauftrag protokolliert.

## Rollen und Berechtigungen

| Funktion | ADMIN | FLIGHT_DIRECTOR | Andere interne Rollen | Öffentlich |
| --- | ---: | ---: | ---: | ---: |
| Momentaufnahme in Administration | ja | nein | nein | nein |
| Momentaufnahme im Flight Director | ja | ja | nein | nein |
| Tagesarchive auflisten | ja | nein | nein | nein |
| Tagesarchiv erstellen/retry | ja | nein | nein | nein |
| Tagesarchiv herunterladen | ja | nein | nein | nein |
| Tagesarchiv löschen | ja | nein | nein | nein |

Nicht berechtigte Rollen sehen keine deaktivierten Archivcontrols und erhalten serverseitig immer
eine Rollenprüfung. Verstecken in der UI ist keine Berechtigungsmaßnahme.

## Tastatur und Screenreader

- Die beiden Auswertungstabs verwenden `tablist`, `tab`, `tabpanel`, Pfeiltasten, `Home` und `End`.
- Die Tabsequenz folgt Eventauswahl, aktivem Tab, Momentaufnahme, Aktualisieren, Archivkopfaktion,
  Tabellenaktionen und gegebenenfalls Pagination.
- Statussymbole, Datenschutzbadge, Größen- und Ablaufwerte erzeugen keine zusätzlichen Tabstopps.
- Tabellenaktionen erhalten Archivdatum und Event-Version im Accessible Name.
- Busy-Zustände verwenden `aria-busy`; Änderungen werden in einer reservierten höflichen
  `aria-live`-Region angekündigt.
- Der Löschdialog bindet Fokus, `Escape` bricht ab und der Fokus kehrt zum auslösenden Button zurück.
- Der Diagnosebutton im Belegungsdialog liegt vor der Schließen-Aktion und erhält keinen
  automatischen Fokus.
- Rein informative Tooltips sind nicht Teil der Tabsequenz; alle notwendigen Informationen stehen
  im Accessible Name oder sichtbaren Text.

## Layout-, Theme- und Viewportregeln

- Alle Controls der Werkzeugzeilen verwenden dieselbe Touch-Control-Höhe und gemeinsame Achse.
- Primär- und Sekundärbuttons behalten zwischen idle, busy, disabled und error dieselbe Breite.
- Tabellenkopf, Status- und Aktionsspalten behalten feste Positionen.
- Die Statusfläche ist immer reserviert und verhindert vertikale Sprünge.
- Umfangreiche Listen besitzen genau einen begrenzten Scrollbereich.
- Hell und Dunkel verwenden vorhandene Tokens; Statusfarben werden immer durch Text und Symbol
  ergänzt.
- Der Support-sicher-Hinweis bleibt in beiden Themes kontrastreich, aber neutral und erhält keine
  Erfolgs- oder Gefahrenfarbe.
- `prefers-reduced-motion` lässt notwendige Busy-Indikatoren erkennbar, reduziert aber dekorative
  Übergänge; Statuswechsel bleiben ohne Bewegung verständlich.

Verbindliche Konzept-Viewports:

| Oberfläche | Viewport | Themes |
| --- | ---: | --- |
| Administration Desktop | 1440 × 900 und 1366 × 768 | Hell, Dunkel |
| Administration Tablet | 1180 × 820 und 1024 × 768 | Hell, Dunkel |
| Flight Director Desktop | 1440 × 900 | Hell, Dunkel |
| Flight Director Tablet | 1180 × 820 | Hell, Dunkel |
| Belegungsdialog | dieselben Flight-Director-Viewports | Hell, Dunkel |

Geprüft werden zusätzlich 200 Prozent Browserzoom, lange deutsche Statusbegriffe, 0/1/20 Archive,
Scrollbar-Präsenz sowie Pending-/Ready-/Failed-Wechsel ohne Layoutsprung.

## Browserabnahme

Vor Freigabe von WP2 beziehungsweise WP3 wird im Browser gegen dieses Konzept geprüft:

1. Admin-Navigation und Auswertungstabs bleiben beim Wechsel geometrisch stabil.
2. Momentaufnahme ist per Tastatur ausführbar und verwendet die aktuelle Event-Version.
3. Ein provozierter Versionskonflikt lädt keine Datei herunter und bietet Aktualisieren an.
4. Flight-Director-Auswahl und sichtbare Empfehlung erscheinen getrennt im Clientkontext.
5. Export im geöffneten Belegungsdialog erhält Dialog, Auswahl, Scrollposition und Fokus.
6. Die Archivliste bildet `PENDING`, `BUILDING`, `READY`, `FAILED`, `EXPIRED` und `DELETED` ohne
   springende Spalten ab.
7. Erstellen ist bei `ACTIVE` sichtbar begründet gesperrt und bei `CLOSED` verfügbar.
8. Download erzeugt keinen öffentlichen Link; Löschen verwendet den freigegebenen Dialog.
9. Light/Dark, Desktop/Tablet, reduzierte Bewegung und Screenreader-Namen entsprechen dem Konzept.
10. Canary-Werte für Ticketcode, Hash, Push-Endpunkt, Sitzung, PIN, Freitext und Einzelgewicht
    erscheinen weder im JSON noch in UI-Fehlern oder Dateinamen.

## Nicht Bestandteil

- neue Primäraktionen in Flugzeug- oder Gruppenzeilen,
- eine neue Flight-Line- oder Kassenaktion,
- Diagramme oder Dashboardkarten für Archive,
- ein unbereinigter interner Export,
- öffentliche Downloads oder Share-Links,
- Import, Restore oder Replay im Browser,
- Änderung an Forecast-, Dispatch-, Voraufruf- oder Boardingentscheidungen.

## Freigabecheckliste

- [ ] Informationsarchitektur Administration freigegeben
- [ ] Flight-Director- und Belegungsdialogposition freigegeben
- [ ] Rollenmatrix freigegeben
- [ ] Client-Allowlist und verbotene Felder datenschutzseitig freigegeben
- [ ] Lade-, Fehler-, Leer- und Pending-Zustände freigegeben
- [ ] Desktop-/Tablet-/Light-/Dark-Viewports freigegeben
- [ ] Löschhinweis und Support-sicher-Copy freigegeben

Die Freigabe wird durch Aktualisierung von OQ-19 und dieses Statuskopfs dokumentiert.
