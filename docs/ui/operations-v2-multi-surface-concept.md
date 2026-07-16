# Gesamtkonzept V1: Administration, Flight Line und öffentliche Anzeigen

- Status: Zur fachlichen Freigabe
- Datum: 2026-07-16
- Visuelle Referenz Terminal: `operations-v2-terminal-fids-concept.png`
- Visuelle Referenz mobile Pause: `operations-v2-flight-line-assist-pause-concept.png`
- Ersetzt beziehungsweise konkretisiert: `v1-simplified-operations.md` für die beschriebenen
  Oberflächen
- Betroffene Anforderungen: F-RES-060, F-SLT-020, F-SLT-030, F-SLT-070, F-BRD-010,
  F-BRD-030, F-FLT-030, F-FLT-080, F-MON-010, F-MON-020, F-BEN-030, F-BEN-090,
  Q-UX-010, Q-UX-020, Q-UX-030 und Q-UX-040

## 1. Zielbild

Der Leitstand besitzt nicht eine universelle Oberfläche, sondern vier klar getrennte Arbeitsflächen:

1. **Administration** für Einrichtung, Stammdaten, Sicherung und Auswertung,
2. **Flight Line Supervisor** für Disposition und den Überblick über die gesamte Flotte,
3. **Flight Line Assist** für schnelle Zustandsmeldungen auf Tablet und Mobiltelefon,
4. **Öffentliche Anzeigen** in den Profilen „Standard“ und „Terminal“.

Die Arbeitsflächen teilen Daten, Design-Tokens und Zustände, werden aber nie gleichzeitig als
Dashboard nebeneinander dargestellt. Jede Route ist für genau eine Rolle und Blickdistanz optimiert.

## 2. Gemeinsames visuelles System

Die freigegebene Gestaltung lehnt sich an moderne Cloud-Infrastruktur-Oberflächen an:

- dunkles Schwarz-Navy beziehungsweise helles neutrales Grau als ruhige Grundfläche,
- kompakte Tabellen und Listen statt großer Karten,
- dünne, kontrastreiche Trennlinien und Radien von 4 bis 8 Pixeln,
- eine blaue Primäraktion je Kontext,
- semantische Farben ausschließlich für bestätigte Zustände, Warnungen und Fehler,
- keine Gradienten und keine dekorativen Kennzahlen ohne operative Bedeutung,
- klare, kompakte Groteskschrift für Bedienoberflächen,
- Touch-Ziele mindestens 44 × 44 Pixel, auf mobilen Primäraktionen mindestens 52 Pixel hoch.

Informationstexte sind einem Feld per `aria-describedby` zugeordnet. Informationssymbole sind nicht
Teil der normalen Tab-Reihenfolge. Alle Eingaben, Dialoge und Aktionen funktionieren gleichwertig mit
Maus, Touch, Tastatur und Enter.

## 3. Administration `/admin`

### 3.1 Informationsarchitektur

Die Hauptnavigation enthält:

- Übersicht,
- Einrichtung,
- Stammdaten,
- Auswertung,
- Sicherung & Reset.

Der bisherige Bereich „Betrieb“ entfällt aus der Administration. Laufende operative Zustände und
Unterbrechungen gehören in die Flight-Line-Supervisor-Ansicht. Globale Notfall- und
Veranstaltungsfunktionen bleiben über eine deutlich getrennte, berechtigte Aktion erreichbar.

### 3.2 Stammdaten

Die Standardansicht zeigt nur die kompakte Tabelle des gewählten Stammdatentyps. Der Editor ist im
Ruhezustand geschlossen.

- „Neu“ öffnet einen leeren Editor als rechte Kontextspalte auf Desktop beziehungsweise als
  Vollbild/Bottom-Sheet auf Tablet und Mobil.
- Klick auf eine Zeile oder „Bearbeiten“ öffnet denselben Editor mit den vorhandenen Daten.
- Speichern oder Verwerfen schließt den Editor und gibt die volle Tabellenbreite zurück.
- Tabellen haben keine künstliche Mindesthöhe und kein horizontales Seiten-Scrolling.
- Zeilen enthalten nur die wichtigsten zwei bis vier Angaben; Details stehen im Editor.

Ressourcengruppen zeigen die konkret zugeordneten Flugzeuge. Kapazität, Kapazitätsspanne und größte
gemeinsam transportierbare Gruppe werden aus diesen Flugzeugen abgeleitet und nicht eingegeben.

### 3.3 Bearbeitungsmodus und gefährliche Aktionen

Die Administrator-PIN entsperrt eine Arbeitssitzung. Nach dem Entsperren sind mehrere normale
Änderungen möglich; Sperren beendet die Sitzung. Begründungen werden nur bei außergewöhnlichen oder
irreversiblen Eingriffen verlangt.

Reset besitzt genau einen Bestätigungsdialog. Nach Eingabe des Bestätigungstexts ist die rote
Primäraktion über ihre gesamte Fläche anklickbar, erhält Fokus und reagiert auf Enter. Ein technischer
Fehler lässt den Dialog geöffnet und zeigt eine konkrete, kopierbare Fehlerreferenz.

## 4. Flight Line Supervisor `/flight-line`

Die Desktopansicht ist der Arbeitsplatz einer koordinierenden Person. Sie zeigt gleichzeitig:

- kompakte Flottenliste mit Flugzeug, Ressourcengruppe, Zustand und aktuellem Zeitfenster,
- ausgewähltes Flugzeug mit nächster vorgeschlagener Gruppe,
- Queue und erwartete Folgeumlaufe,
- aktive Betreuung durch Flight Line Assist,
- Abweichungen, Unterbrechungen und manuelle Disposition.

Das Flugzeug ist das primäre Objekt. Pilotencode, Gruppe und Gate sind untergeordnete Informationen.
Der Standardumlauf bleibt mit `NEXT`, `IM FLUG`, `GELANDET` und `VERFÜGBAR` ausführbar. Sonderfälle
liegen im Kontext des gewählten Flugzeugs und dominieren den Standardpfad nicht.

Die Supervisor-Ansicht kann einen automatischen Voraufruf übersteuern, eine Gruppe bewusst früher
zum Gate voraufrufen, einen Voraufruf zurücknehmen und nicht automatisch lösbare Konflikte
disponieren. Die davon getrennte Aktion `NEXT` bestätigt weiterhin erst bei der operativen
Übernahme Flugzeug und Boarding. Jede Abweichung wird versioniert und auditiert.

## 5. Flight Line Assist `/flight-line/assist`

### 5.1 Zweck und Geräte

Flight Line Assist ist eine eigenständige PWA-Ansicht für iPad, iPad mini, iPhone und vergleichbare
Geräte. Sie ist für mehrere gleichzeitig arbeitende Helfer ausgelegt. Die Oberfläche zeigt keine
vollständige Queue und keine komplexe Disposition.

### 5.2 Standardablauf

1. Unter „Jetzt betreuen“ erscheinen nur Flugzeuge, die eine Aktion benötigen und nicht bereits von
   einem anderen Gerät betreut werden.
2. „Übernehmen“ reserviert die Betreuung kurzzeitig für dieses anonyme Administrationsgerät.
3. Die Detailansicht zeigt Flugzeugkennung, Zustand, Gruppe, Gate und genau die nächsten sinnvollen
   Aktionen.
4. Nach einer bestätigten Zustandsmeldung wird die Betreuung beendet oder für den unmittelbar
   folgenden Schritt verlängert.
5. Das Gerät springt zurück zur Liste und bietet das nächste unbeaufsichtigte Flugzeug an.

Die Reservierung ist nur eine Bedienkoordination, keine Flugzeug-, Pilot- oder Sicherheitsfreigabe.
Sie läuft bei Inaktivität automatisch aus und kann vom Supervisor aufgehoben werden. Fachliche
Schreibkommandos prüfen weiterhin erwartete Version und Idempotenz-ID.

### 5.3 Zustandsabhängige Hauptaktionen

| Beobachteter Zustand | Sichtbare Hauptaktionen |
| --- | --- |
| verfügbar, nächste Gruppe bereit | `Boarding beginnen`, `Noch nicht bereit` |
| Boarding | `Off-Block / im Flug`, `Boarding stoppen` |
| im Flug | `Gelandet / On-Block` |
| gelandet | `Verfügbar`, `Tanken`, `Pause` |
| Tanken oder Pause | `Wieder verfügbar` |
| Störung | `Unterbrechen`, danach nur berechtigte Wiederaufnahme |

Auf dem Telefon wird immer nur ein Flugzeug mit großen, einhändig erreichbaren Aktionen gezeigt.
Auf dem Tablet stehen links „Jetzt betreuen“ und rechts das übernommene Flugzeug. Kritische Aktionen
verwenden eine kurze Inline-Bestätigung, keinen mehrstufigen Dialog.

### 5.4 Flugzeugpause mit optionaler Dauer

„Pause“ öffnet eine kompakte Auswahl mit häufigen Zeitspannen, einer freien Minutenangabe und
„Dauer noch unbekannt“. Die Auswahl ist eine organisatorische Schätzung und keine
Verfügbarkeitszusage.

- Mit geschätzter Dauer erhält das Flugzeug einen erwarteten Rückkehrzeitpunkt. Die Prognose darf es
  ab diesem Zeitpunkt wieder als voraussichtliche Kapazität berücksichtigen und kennzeichnet die
  daraus berechneten Zeitfenster entsprechend.
- Kurz vor Ablauf erscheint auf Supervisor und Assist die Aufgabe „Pause endet – Verfügbarkeit
  prüfen“.
- Erst „Wieder verfügbar“ bestätigt den tatsächlichen Zustand. Der Zeitablauf allein setzt das
  Flugzeug nicht automatisch auf verfügbar.
- Bleibt die Bestätigung nach dem geschätzten Ende aus, bleibt das Flugzeug pausiert und die
  Prognosequalität wird herabgestuft beziehungsweise neu berechnet.
- Bei „Dauer noch unbekannt“ wird das Flugzeug vollständig aus der prognostizierten Kapazität
  entfernt, bis eine Dauer ergänzt oder die Verfügbarkeit bestätigt wird.

### 5.5 Gäste am Gate

Die Assistenz sieht ausschließlich anonyme Ticket- und Gruppenkennungen sowie Zählwerte:

- erwartet,
- am Gate bestätigt,
- noch fehlend,
- nachzurufen.

„Gruppe am Gate aufrufen“ ist eine lokale organisatorische Hilfe. Fehlende Personen, No-Show und
Zurückstellung verwenden die bereits freigegebenen gruppenschützenden Sonderfallregeln.

## 6. Automatischer Voraufruf und operative Bestätigung

### 6.1 Begriffliche Trennung

Der automatische Standardfall heißt fachlich **Voraufruf**. Öffentlich erscheint er als
`GO TO GATE` beziehungsweise „Bitte zum Gate“. Er bindet noch kein Flugzeug und startet keinen
Umlauf.

`NEXT` bleibt die **operative Bestätigung**. Erst diese Aktion übernimmt den aktuellen Vorschlag,
bindet die Fluggruppe an das bestätigte Flugzeug, startet die Boardingmessung und schaltet den
öffentlichen Zustand auf `BOARDING` beziehungsweise „Bitte jetzt zur Flight Line“.

Damit übernimmt das System die laufende Queue-Beobachtung, ohne eine flugbetriebliche Entscheidung
zu treffen.

### 6.2 Konfigurierbare Parameter

- gewünschter Vorlauf am Gate in Minuten,
- maximal akzeptierte Wartezeit am Gate,
- Mindestqualität der Prognose für automatische Voraufrufe,
- optionaler zusätzlicher Vorlauf für große oder nur eingeschränkt passende Gruppen,
- Ruhezeit zwischen zwei automatischen Aufrufen desselben Gates,
- Aktivierung pro Veranstaltung und Ressourcengruppe.

Die Einrichtung zeigt verständliche Minutenwerte und eine Vorschau, keine technischen Gewichtungen.

### 6.3 Entscheidungslogik

Nach jedem relevanten Ereignis berechnet das System Queue, Prognosen und Voraufrufe neu:

1. Berücksichtigt werden nur aktive Ressourcengruppen, gültige wartende Gruppen und voraussichtlich
   verfügbare, ausreichend große Flugzeuge.
2. Gruppenbindung und Reihenfolge der gemeinsamen Queue bleiben erhalten.
3. Das System schätzt für jede vorderste passende Gruppe das früheste realistische Boardingfenster.
4. Ein automatischer Voraufruf erfolgt, wenn das Fenster innerhalb des konfigurierten Vorlaufs liegt,
   die erwartete Gate-Wartezeit den Grenzwert nicht überschreitet und die Prognose ausreichend
   belastbar ist.
5. Passt eine Gruppe nur in einen Teil der Flotte, wird deren reale Flugzeugverfügbarkeit in das
   Zeitfenster eingerechnet; sie wird nicht vorschnell für ein kleineres Flugzeug aufgeteilt.
6. Reicht die Datenqualität nicht aus, bleibt die Gruppe auf „Warten“ und der Supervisor erhält eine
   begründete Ausnahme statt eines automatischen Aufrufs.

Bekannte Pausenenden fließen als geschätzte Verfügbarkeit ein. Pausen ohne Dauer liefern keine
Kapazität. Ein überschrittenes, aber noch nicht bestätigtes Pausenende wird nicht als sichere
Verfügbarkeit behandelt.

Der Voraufruf ist ein idempotentes, versioniertes Systemkommando mit Audit-Eintrag und Auslöser
`AUTOMATIC_PRECALL`. Ein paralleler manueller Befehl wird über die erwartete Version geordnet; ein
veralteter Schreibversuch wird sichtbar abgelehnt.

### 6.4 Änderungen nach dem Voraufruf

- Verbessert oder verschlechtert sich das Fenster geringfügig, wird nur das Zeitfenster aktualisiert.
- Wird die maximale Gate-Wartezeit voraussichtlich deutlich überschritten, bleibt die Gruppe am Gate
  und erhält „Verzögert – neues Fenster folgt“; sie wird nicht still zurück auf „Warten“ gesetzt.
- Unterbrechung oder Notfallmodus stoppt neue Voraufrufe sofort und schaltet öffentliche Anzeigen auf
  den dafür vorgesehenen neutralen Zustand.
- Ein Supervisor kann Voraufruf, Gate oder Reihenfolge bewusst korrigieren. Die Auswirkung wird vor
  Bestätigung angezeigt und auditiert.

## 7. Öffentliche Anzeigen

### 7.1 Profil „Standard“ `/fids`

Das Standardprofil verwendet das gemeinsame moderne Designsystem. Es eignet sich für normale
Monitore und zeigt Produkt, Gruppe, Gate, Status und Zeitfenster in einer klaren, ruhigen Tabelle.

### 7.2 Profil „Terminal“ `/fids?style=terminal`

Das Terminalprofil ist eine eigenständige Darstellung im Stil klassischer Flughafen-Anzeigetafeln:

- schwarze, matte Grundfläche,
- stark kondensierte beziehungsweise Split-Flap-inspirierte, selbst gehostete Schrift,
- Großbuchstaben und tabellarische Ziffern,
- Weiß für neutrale Inhalte, Gelb für `GO TO GATE`, Cyan für `BOARDING`, Orange für Verzögerung,
- keine Animation, die Lesbarkeit oder Barrierefreiheit beeinträchtigt,
- dieselben Inhalte und Zustände wie im Standardprofil.

Alle beschreibenden Texte, Spaltenüberschriften, Statusangaben und Hinweise des Terminalprofils sind
Englisch. Dazu gehören insbesondere `DEPARTURES`, `GROUP`, `FLIGHT`, `GATE`, `STATUS`,
`TIME WINDOW`, `WAITING`, `GO TO GATE`, `BOARDING`, `DEPARTED` und `DELAYED`. Der Eigenname
„Rundflug-Leitstand“ darf unverändert bleiben. Es erscheinen keine gemischten deutsch-englischen
Statuszeilen.

Der Stil wird je Display-Verknüpfung in der Administration gespeichert. Der URL-Parameter dient nur
der Vorschau beziehungsweise gezielten Installation; Personal muss den Stil nicht bei jedem Start
neu wählen.

### 7.3 Öffentliche Statusabbildung

| Interner Zustand | Standard | Terminal |
| --- | --- | --- |
| wartend | Warten | WAITING |
| Voraufruf | Bitte zum Gate | GO TO GATE |
| operativ aufgerufen/Boarding | Boarding | BOARDING |
| im Flug/abgeflogen | Abgeflogen | DEPARTED |
| verzögert/unsicher | Verzögert, neues Fenster folgt | DELAYED |

Exakte Uhrzeiten werden nicht zugesagt. Anzeigen verwenden Zeitfenster, „Jetzt“ oder eine
unscharfe Restzeit. Personenbezogene Daten erscheinen nicht.

### 7.4 Sichtbarkeit abgeflogener Zeilen

Nach bestätigtem `IM FLUG` zeigt das Standardprofil „Abgeflogen“ und das Terminalprofil `DEPARTED`.
Die Zeile bleibt standardmäßig fünf Minuten sichtbar und wird danach automatisch aus beiden
öffentlichen Anzeigen entfernt. Die Nachlaufzeit ist pro Display zwischen einer und 15 Minuten
konfigurierbar.

Das Ausblenden verändert weder Umlauf, Ticketstatus noch Audit-Historie. Eine abgeflogene Gruppe
bleibt über ihre anonyme Ticketstatusseite erreichbar; lediglich die für wartende Gäste nicht mehr
relevante FIDS-Zeile verschwindet. Abgeschlossene oder stornierte Zeilen werden ebenfalls nicht
erneut in die laufende Abflugliste aufgenommen.

## 8. Fehler-, Offline- und Parallelverhalten

- Ein Serverfehler ersetzt keine vorhandenen Daten durch leere Listen.
- Der letzte bestätigte Stand bleibt sichtbar und wird eindeutig mit Alter und Verbindungsstatus
  gekennzeichnet.
- Schreibaktionen sind bei unbestätigtem Stand gesperrt; Lesen und lokales Orientieren bleiben
  möglich.
- Nach Wiederverbindung wird der aktuelle Stand neu geladen. Lokale Bedienentwürfe werden nicht als
  viele einzelne Änderungen hochgezählt, sondern als ein noch nicht bestätigter Arbeitsvorgang.
- Live-Updates verändern nicht unerwartet die aktuelle Auswahl. Veraltete Aktionen zeigen den neuen
  Stand und verlangen eine erneute bewusste Bestätigung.

## 9. Abnahmekriterien

1. Administration, Supervisor, Assist und beide FIDS-Profile sind getrennte, direkt adressierbare
   Oberflächen.
2. Die Administration zeigt im Ruhezustand nur kompakte Tabellen; Editoren öffnen ausschließlich
   nach „Neu“ oder „Bearbeiten“.
3. Flight Line Assist lässt einen Standardzustand in höchstens zwei Interaktionen erfassen.
4. Zwei Assist-Geräte können nicht unbemerkt denselben veralteten Zustand schreiben.
5. Automatische Voraufrufe respektieren Queue, Gruppenbindung, Prognosequalität und maximale
   Gate-Wartezeit.
6. Kein automatischer Voraufruf bindet ein Flugzeug oder ersetzt `NEXT`.
7. Standard- und Terminal-FIDS zeigen denselben bestätigten fachlichen Stand mit unterschiedlicher
   Typografie.
8. Desktop, iPad, iPad mini und iPhone werden in Hell und Dunkel im Browser geprüft; das
   Terminalprofil wird auf einem 16:9-Monitor geprüft.
9. Buttons reagieren auf Text und gesamte Fläche mit Maus und Touch; Enter löst die fokussierte
   Primäraktion aus.
10. Keine Oberfläche speichert oder zeigt Namen oder Telefonnummern.
11. Jede operative oder automatische Zustandsänderung ist idempotent, versioniert und append-only
    auditiert.
12. Bei Serverausfall bleiben letzte bestätigte Daten lesbar; die Oberfläche erklärt den nächsten
    sinnvollen Schritt ohne Fehlerkaskade.
13. Das Terminalprofil verwendet ausschließlich englische beschreibende Texte und Statusbegriffe.
14. Eine abgeflogene Zeile verschwindet nach der konfigurierten Nachlaufzeit, ohne fachliche Daten zu
    löschen.
15. Eine optionale Pausendauer beeinflusst die Prognose, setzt ein Flugzeug aber niemals ohne
    menschliche Bestätigung auf verfügbar.

## 10. Umsetzungsreihenfolge nach Freigabe

1. Server- und D1-Stabilität sowie verlässliches Laden des bestätigten Betriebsstands,
2. gemeinsames Designsystem und kompakte Administration,
3. Flight Line Supervisor auf Flugzeugbasis,
4. Flight Line Assist mit anonymer Betreuungsreservierung,
5. automatischer Voraufruf und konfigurierbare Gate-Wartezeit,
6. FIDS Standard und Terminal,
7. vollständige Browser-, Parallelitäts-, Offline- und Abnahmeprüfung.

## 11. Mit dieser Freigabe zu bestätigende Konkretisierungen

Die fachliche Freigabe dieses Dokuments bestätigt ausdrücklich:

1. Der bisherige öffentliche Vorbereitungsstatus wird als handlungsorientierter Voraufruf
   „Bitte zum Gate“ beziehungsweise `GO TO GATE` konkretisiert.
2. Der Voraufruf darf prognosebasiert automatisch erfolgen; `NEXT`, Flugzeugbindung und
   Boardingbeginn bleiben menschlich bestätigt.
3. Operative Betriebssteuerung wechselt aus der Administration in Flight Line Supervisor.
4. Flight Line Assist koordiniert parallele Geräte über kurzlebige anonyme Betreuungsreservierungen.
5. Standard- und Terminal-FIDS sind zwei Darstellungsprofile desselben fachlichen Datenstands.
6. Das Terminalprofil ist vollständig englisch; abgeflogene Zeilen werden nach kurzer
   konfigurierbarer Nachlaufzeit ausgeblendet.
7. Eine Flugzeugpause kann eine optionale geschätzte Dauer besitzen. Sie verbessert die Prognose,
   ersetzt aber nicht die Bestätigung der tatsächlichen Verfügbarkeit.
