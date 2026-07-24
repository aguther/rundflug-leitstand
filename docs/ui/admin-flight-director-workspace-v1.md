# Freigegebenes Konzept: Admin- und Flight-Director-Oberfläche

- Status: freigegeben
- Freigabe: Auftraggeberdialog vom 24. Juli 2026
- Betroffene Anforderungen: F-ADM-060, F-ADM-080, Q-UX-020 und F-SLT-040
- Leitentscheidung: ADR-0026

Dieses Dokument ist die verbindliche UI-Referenz für den veranstaltungsbezogenen
Administrationsarbeitsplatz und die organisatorische Betriebssteuerung des Flight Directors.
Bestehende Fachregeln, Gruppenschutz und menschliche Bestätigung operativer Entscheidungen bleiben
unverändert.

## Administration

Die Hauptnavigation besteht ausschließlich aus **Übersicht**, **Veranstaltungen**, **Konten**,
**Auswertung** und **Sicherung & Reset**.

### Übersicht

- Ein großes SVG-Diagramm zeigt für genau die gewählte Veranstaltung kumulativ verkaufte und
  abgeschlossene Tickets.
- Die offene Differenz wird als Fläche zwischen beiden Linien dargestellt.
- Darunter folgen kompakte Kennzahlen und schreibgeschützte Veranstaltungsdaten.
- Die Standardauflösung beträgt 15 Minuten. Lange Zeiträume werden automatisch auf höchstens
  96 Intervalle beziehungsweise 97 Stützpunkte verdichtet.

### Veranstaltungen

Eine such- und sortierbare Veranstaltungstabelle steht vor dem Arbeitsbereich. Die gewählte Zeile
bestimmt den Kontext der acht Schritte:

1. Veranstaltung
2. Gates
3. Ressourcengruppen
4. Flugzeuge
5. Pilotencodes
6. Produkte
7. Betrieb
8. Abschluss

Die ersten sechs Schritte verwenden die vorhandenen Vollständigkeitsprüfungen. Nach Schließung der
Veranstaltung ist **Betrieb** abgeschlossen und **Abschluss** der aktive letzte Schritt.

Alle Stammdatentabellen werden vor der Paginierung stabil und numerisch korrekt sortiert. Eine
Spaltenaktion durchläuft aufsteigend, absteigend und Standardsortierung. Ein Klick auf eine
Stammdatenzeile beziehungsweise Enter oder Leertaste bei Tastaturfokus öffnet den zentrierten,
responsiven `ModalDialog` in breiter Ausführung. Eine redundante Tabellenspalte **Aktionen** wird
nicht angezeigt; der Tabellenbereich verschiebt sich nicht.

Die Tabellen zeigen die für die Entscheidung nötigen Zuordnungen unmittelbar:

- Gates: Typ, Aktivität, Reihenfolge, Ressourcengruppen und Anzeigefilter
- Ressourcengruppen: Gate, Flugzeuge, Kapazität, Umlaufplanung, Voraufruf und Produkte
- Flugzeuge: Typ, Sitzplätze, informative Zuladung, Ressourcengruppe, Pilotencode und
  schreibgeschützter Betriebsstatus
- Pilotencodes: Organisationshinweis, Aktivität, Pause und Umlaufbindung
- Produkte: Ressourcengruppe, Gate, Preis, Referenzdauer, Verkaufsstatus und Reihenfolge

Alte Links mit `area=setup` oder `area=master-data` öffnen den passenden Veranstaltungsschritt.
`area=audit` öffnet **Abschluss**.

### Betrieb und Abschluss

**Betrieb** enthält ausschließlich Veranstaltungsstatus und -ende, Not-Halt einschließlich
Admin-Aufhebung sowie Produktkapazität, Verkaufsempfehlungen und Verkaufssteuerung. Flugzeugstatus,
Tankplanung, Ressourcengruppenstatus, Pilotenpausen und operative Hinweise werden hier nicht
dupliziert.

**Abschluss** enthält Tagesberichte, Betriebshistorie, Prognosegüte und Audit. Die dokumentierte
Besetzungskorrektur nach Flugbeginn bleibt ausschließlich hier. Sie ist ein administrativer
Korrekturpfad und keine operative Umbesetzungs- oder Freigabefunktion.

**Konten** bleiben veranstaltungsübergreifend. **Auswertung** enthält ausschließlich den
Prognose-Simulator.

### Stammdatenvorlage

Der Export erzeugt `rundflug-master-data-template` in Formatversion 1. Vor einem Import zeigt ein
breiter Dialog Datei, Zählwerte, Referenz- und Dublettenfehler sowie die Eignung der
Zielveranstaltung. Importiert wird nur all-or-nothing in eine leere Veranstaltung im Status
`PREPARATION`. Es gibt weder Merge noch Ersetzen.

## Flight Director

Der Kopf der bestehenden Ein-Bildschirm-Ansicht zeigt eine kompakte Betriebslage und den Button
**Betrieb**. Die Priorität lautet:

1. Not-Halt
2. veranstaltungsweite Unterbrechung
3. veranstaltungsweiter Hinweis
4. Hinweis der gefilterten Ressourcengruppe
5. Betrieb normal

Der zentrierte Dialog besitzt die Tabs **Hinweise**, **Ressourcengruppen**, **Pilotenpausen** und
**Not-Halt**. Zustandsänderungen benötigen eine dokumentierte Begründung. Der Flight Director darf
veranstaltungsweite organisatorische Hinweise setzen; die Not-Halt-Aufhebung bleibt Admin-only.

Flugzeugstatus, Tankplanung, konkrete Belegung und Pilotenzuweisung verbleiben in den
Flight-Line-Zeilen. Die Oberfläche erzeugt keine automatische Umbesetzung und keine
sicherheitsbezogene oder luftrechtliche Freigabe.

## Interaktion und responsive Abnahme

- Info-Symbole sind fokussierbare Buttons. Der Hilfetext erscheint nur bei Hover, Fokus oder
  Touch/Klick auf das Symbol, nicht beim Fokus des Eingabefelds.
- Modale fangen den Tastaturfokus ein, schließen mit Escape und geben den Fokus an den Auslöser
  zurück.
- Die Referenzansichten werden in Hell und Dunkel sowie auf Desktop, Tablet und 430-Pixel-Mobilbreite
  geprüft.
- Es werden ausschließlich synthetische Daten verwendet; Gastnamen oder andere personenbezogene
  Daten sind nicht Bestandteil der Oberflächen.
