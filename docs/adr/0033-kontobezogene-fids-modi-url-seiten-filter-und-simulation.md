# ADR-0033: Kontobezogene FIDS-Modi, URL-Seiten, Filter und gemeinsame Simulation

- Status: Akzeptiert
- Datum: 2026-08-02
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: V173-FID-010, V173-PRI-010, V173-LAY-010, V173-SET-010,
  V173-AUT-010, V173-API-010, V173-DAT-010, V173-OPS-010, V173-QA-010

## Kontext

Das bisherige Standard-FIDS lud eine kleine, anonyme Board-Projektion und zeigte alle Monitore eines
Kontos gleich an. Eine feste Seitenzuordnung für mehrere Bildschirme, ein geteilter Dringlichkeits-
und Rotationsbereich sowie veranstaltungsbezogene Produkt- und Gatefilter fehlten. Die
Forecast-Simulation besaß außerdem eine eigene FIDS-Darstellung. Dadurch konnten Layout, Paging,
Einstellungen, Realtime- und Offline-Verhalten zwischen Simulation und Livebetrieb auseinanderlaufen.

Die bestehende öffentliche Board-API ist eine anonyme Besucherschnittstelle. Sie darf weder die
geschützte Display-Konfiguration offenlegen noch durch eine inkompatible Schemaänderung beschädigt
werden. Ein DISPLAY-Konto ist bereits der autorisierte, administrierbare Displaykontext; eine zweite
Profilentität würde Besitz, Löschung, Sitzungswiderruf und Versionskonflikte unnötig duplizieren.

## Entscheidung

### DISPLAY-Konto als einziges Profil

FIDS-Einstellungen gehören weiterhin genau zu einem Operator-Konto und einer Veranstaltung. Es gibt
keine zusätzliche Terminal- oder Displayprofil-Tabelle. Mehrere Geräte mit demselben Konto teilen
Ansichtsmodus, Zeilenzahl, Layout, Theme, Split-Parameter und Inhaltsfilter. Benötigen Monitore
unterschiedliche Filter, erhalten sie unterschiedliche DISPLAY-Konten. ADMIN darf dieselben
FIDS-Pfade verwenden; DISPLAY bleibt auf FIDS-spezifische Lese- und Schreibpfade beschränkt.

### Persistierte Konfiguration und lokaler URL-Zustand

`FidsPreferences` wird kompatibel um `viewMode`, `priorityGroupCount`,
`rotationIntervalSeconds` und `contentFilter` erweitert. Bestehende Zeilen erhalten neutrale Defaults.
`page` und `setup` sind dagegen ausschließlich URL-Zustand:

- `page` bestimmt im Modus `FIXED_PAGE` die feste Seite dieses Browserfensters;
- `setup` blendet lokale Einrichtungsaktionen ein;
- beide Werte werden weder in D1 noch im Browser-Storage persistiert;
- ein teilbarer Link enthält Veranstaltung und Seite, aber keinen Setupzustand, keine Sitzung und
  keine Filter- oder Kontodaten.

Die früheren geschützten FIDS-Parameter `gateId` und `gate` werden nicht mehr ausgewertet oder
übernommen. Die anonyme Public-Board-API behält ihre unabhängige `gateId`-Semantik.

Damit können mehrere Displays desselben Kontos verschiedene feste Seiten derselben gefilterten Liste
zeigen, ohne ihre gemeinsamen Einstellungen gegenseitig zu überschreiben. Realtime-Signale laden die
aktuelle Seite neu, ändern aber niemals die URL-Seite.

### Serverseitige Projektion, Filterung und Paging

Die Worker-Projektion ist die gemeinsame Quelle für geschütztes FIDS und anonymes Public Board.
Produkt- und Gatefilter werden in SQL vor Zählung, Sortierungsausschnitt und Limit angewendet. Eine
leere Liste bedeutet „alle“; innerhalb einer Dimension gilt ODER, zwischen Produkt und Gate AND.
Filter-IDs werden beim Schreiben gegen die aktuelle Veranstaltung geprüft.

Der geschützte Board-Endpunkt liefert stabile `rowId`-Werte, exakt die benötigte Seite sowie
Seitenmetadaten. Er lädt nicht erst alle Gruppen in den Browser. Der öffentliche Endpunkt verwendet
dieselbe fachliche Projektion und Sortierung, entfernt aber geschützte technische IDs wieder und hält
seinen bestehenden Vertrag unverändert.

### Feste und geteilte Ansicht

`FIXED_PAGE` zeigt ausschließlich die per URL bestimmte Seite. `SPLIT` partitioniert nach der
maßgeblichen Backend-Reihenfolge:

1. `BOARDING` und `COME_TO_FLIGHT_LINE` stehen in der maßgeblichen Backend-Reihenfolge zuerst;
2. bereits ausgelieferte `IN_FLIGHT`-, `LANDED`- und `COMPLETED`-Zeilen folgen während der
   veranstaltungsweit konfigurierten Nachlaufzeit, neueste `departedAt` zuerst;
3. `PREPARE` füllt danach freie reservierte Prioritätsplätze;
4. handlungsrelevante und kürzlich abgeflogene Gruppen erweitern den oberen Bereich gemeinsam bis zur
   gesamten sichtbaren Zeilenkapazität;
5. `overflowCount` weist ausschließlich nicht sichtbare relevante obere Einträge aus;
6. nur der disjunkte übrige Bereich rotiert im gespeicherten Intervall.

Der Worker schließt sämtliche handlungsrelevanten und kürzlich abgeflogenen Zeilen sowie die oben
ausgewählten `PREPARE`-Zeilen kategorisch aus der unteren Abfrage aus. Domain und Simulation verwenden
denselben reinen Kapazitätsplan. Eine Zeile kann daher nie zugleich oben und unten erscheinen. Der
Controller plant genau einen Einmal-Timer für den nächsten sichtbaren Ablaufzeitpunkt. Nach Ablauf
lädt er das Board neu, plant anhand der Serverantwort neu und versucht denselben Ablaufzeitpunkt nicht
in einer Schleife erneut; das 15-Sekunden-Polling bleibt die Rückfallebene. Bei Verbindungsfehlern
bleibt der letzte bestätigte Stand sichtbar.

Oberer und unterer Bereich teilen dasselbe physische Zeilenraster. Beide Bereiche haben eigene
Überschriften, der untere Bereich trägt die Seiteninformation. Reservierte, aber noch unbelegte Plätze
bleiben als geometrische Leerzeilen erhalten. Bereichsspezifische Leerzustände überdecken weder die
andere Tabelle noch die Überschrift. Lange Kennungen werden einzeilig gekürzt und per Tooltip
zugänglich; Zeitfenster verwenden eine kompakte, nicht umbrechende Darstellung.

### Eine React-Experience für Livebetrieb und Simulation

Live-FIDS und Simulation verwenden dieselben Komponenten, denselben Controller, denselben URL-Adapter,
denselben Einstellungsdialog sowie dieselbe Fixed-/Split-/Filter- und Timerlogik. Nur die Datenquelle
unterscheidet sich:

- live: Worker-API, erwartete Version, EventCoordinator und WebSocket/Polling;
- Simulation: synthetische In-Memory-Projektion, lokale Simulationspräferenzen und Simulationsbanner.

Die Simulation erfindet damit keine zweite UI-Semantik. Persistenz und Verbindung bleiben trotzdem
klar getrennt und Simulationsdaten können nicht in den Livebetrieb geschrieben werden.

### Konsistenz, Datenschutz und Wiederherstellung

Schreibkommandos laufen im vorhandenen EventCoordinator je Veranstaltung serialisiert. Erwartete
Version, Idempotenzschlüssel, Audit und minimale Outbox werden in einer konsistenten D1-Batchgrenze
gespeichert. Audit und Outbox enthalten keine PIN, Sitzung, Ticket-Token oder vollständige
Boardprojektion. Ein Versionskonflikt überschreibt keine neuere Einstellung; der Client lädt den
bestätigten Stand nach.

Migration `0061_fids_fixed_split_filters.sql` ist additiv. Vor Anwendung wird eine
D1-Time-Travel-Marke oder vollständige D1-Sicherung angelegt. Die vollständige Schema-Rückkehr erfolgt
per Time Travel beziehungsweise Wiederherstellung. Die in ADR-0021 festgelegte Ausnahme von Konten,
Sitzungen und FIDS-Präferenzen aus portablen R2-Sicherungen bleibt bestehen.

## Folgen und Nachweise

- Die geschützte API kann mehr technische Metadaten liefern, ohne die anonyme Schnittstelle zu
  erweitern.
- Filterwechsel gelten absichtlich für alle Geräte desselben Kontos; getrennte Filter erfordern
  getrennte DISPLAY-Konten.
- Ein Split-Display rotiert nur bei mindestens zwei unteren Seiten. Ablauf- und Rotationstimer sowie
  laufende Requests werden beim Wechsel oder Unmount beendet. Eine durch Zustandsänderung ungültige
  Unterseite lädt zunächst Seite 1, ohne den letzten bestätigten Stand zwischenzeitlich zu leeren.
- `DOUBLE` bleibt gespeichert, fällt unter 1280 CSS-Pixel aber kontrolliert auf eine Spalte zurück.
- Contract-, Domain-, Worker- und DOM-Tests decken Defaults, Constraints, Partitionierung, Paging,
  Ablauf-Timer, Schleifenfreiheit, Offline-Stand, URL-Datenschutz, Idempotenz und Konflikte ab.
- Die visuelle Abnahme vergleicht Live- und Simulationsansicht in Light und Dark bei 1920×1080,
  1440×900, 1280×720, 1024×768, 800×600 und 640×600 mit dem freigegebenen Konzept.
