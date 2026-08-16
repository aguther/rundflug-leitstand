# ADR-0054: Einheitliche Forecast- und Dispatch-Pipeline

- Status: Akzeptiert
- Datum: 2026-08-16
- Entscheidung: Ablösung der Legacy-Pfade durch eine operative Forecast- und Simulationspipeline
- Betroffene Anforderungen: F-PRG-010 bis F-PRG-120, F-FLN-120, Q-WAR-040, Q-WAR-060,
  Q-PER-010, Q-PER-030 und Q-TST-010
- Ersetzt: ADR-0041; ersetzt die Zwei-Engine-Entscheidung aus ADR-0042

## Kontext

Die produktive Prognose kombinierte einen linearen Altpfad mit einem Dispatch-Overlay und führte bei
geänderten Completion-Zeiten aktiver Umläufe bis zu zwei vollständige Berechnungen aus. Der
Browser-Simulator besaß zusätzlich eine eigene Legacy-Engine für Presets. Dauerstichprobe,
Scheduler-Lane, Replay, sichtbare Projektion und Diagnose konnten dadurch verschiedene Annahmen
verwenden. Im Dispatch-Zustandsvergleich wurden prognostische Überholungen außerdem vor
Passagierzahl und Auslastung bewertet, obwohl ADR-0032 die umgekehrte Reihenfolge festlegt.

## Entscheidung

### Eine produktive Domainberechnung

Aktive Umläufe (`CALLED`, `IN_FLIGHT`, `LANDED`) werden zuerst als unveränderliche
Ressourcenbelegungen projiziert. Bestätigte Ist-Zeitpunkte und Flugzeug-/Pilotenzuordnungen bleiben
unverändert; nur offene Meilensteine werden fortgeschrieben. `LANDED` belegt beide Ressourcen bis
zur prognostizierten Completion. Diese Freigabefenster werden innerhalb derselben Domainberechnung
auf die Scheduler-Lanes übertragen. Der Worker führt genau einen Forecast-Lauf aus.

`DRAFT`-Projektionen entstehen ausschließlich aus dem begrenzten Dispatch-Plan und dem linearen
Langzeit-Replay. Sie erben keine Felder aus einer zweiten Projektion. Eingabereihenfolge sowie die
Trennung von Plan-, Prognose- und Ist-Zeit bleiben erhalten.

### Eine Dauerbasis je Lane und Produkt

Der Resolver wählt deterministisch in dieser Reihenfolge: aktueller Veranstaltungstag plus Produkt
und Flugzeugtyp, aktueller Tag plus Produkt, Historie plus Produkt und Typ, Produkthistorie,
abgeleitete Referenz-Umlaufzeit. Tageswerte werden vollständig geladen; der historische
Kaltstartkorpus ist je Produkt und Produkt-/Flugzeugtyp begrenzt. Unterbrechungs- und
Slowdown-überlappende Umläufe bleiben ausgeschlossen.

Die auf einer Lane ausgewählte Schätzung wird einschließlich Qualitätsstufe, akzeptierter
Stichprobengröße, Alter, Datenbasis und Referenzwert an Scheduler, Replay, sichtbare Projektion und
Snapshot weitergereicht. Replay schätzt nicht erneut.

### Zielordnung und Diagnose

Kandidaten und Suchzustände verwenden dieselbe lexikografische Ordnung aus ADR-0032:

1. harte Aufrufe und aktive Leases;
2. Must-Serve wegen Maximalwartezeit oder bestätigter Überholgrenze;
3. Produktdefizit und Starvation;
4. Passagierzahl und nahe Sitzplatzauslastung;
5. Überholungen, Wartealter und Queue-Reihenfolge;
6. PREPARE und Vorplanstabilität;
7. technische IDs.

„Optimal“ bezeichnet die beste deterministische Lösung innerhalb der dokumentierten Gruppen-,
Kandidaten-, Wellen- und Beam-Grenzen. `DispatchPlan` enthält den Objective-Vektor und Angaben zu
erreichten Grenzen. Jeder Batch enthält die daraus abgeleiteten Fakten, ohne zweite Bewertung:
geschützte Verpflichtungen, Must-Serve-Zähler, Produktdefizit, älteste Wartezeit, belegte/freie
Sitze, prognostische Überholungen und erhaltene Vorplanmitglieder.

### Verträge, Persistenz und Simulator

Der interne Operation-Board- und Assistance-Vertrag führt `decisionDetails` optional. Öffentliche
Ticket- und FIDS-Verträge bleiben unverändert. Migration `0004_dispatch_decision_details.sql`
speichert validiertes JSON additiv an Rotation, Snapshot und kurzlebiger Lease. Alte Clients und
der vorherige Worker ignorieren die Spalten; ein Tabellen-Rebuild ist für den Rollback nicht nötig.

Presets und der einfache Editor werden an der Engine-Grenze auf eine synthetische operative
Topologie abgebildet. Importierte V1-/V2-Modelle gelangen unverändert in dieselbe operative Engine.
Die Module `legacy-simulation-*` entfallen. Seed-Vertrag, `sampleTriangular`-Fassade und Importformate
bleiben bestehen; Ergebnisbaselines werden als neue operative Vergleichsbasis versioniert.

## Folgen und Nachweise

- Weniger Fachpfade und keine Worker-Konvergenz reduzieren Drift und Laufzeitrisiko.
- Forecastfenster und Simulatorbaselines dürfen sich nachvollziehbar durch Dauerbasis und
  Zielordnung ändern.
- Domain-, Worker-, Replay-, Simulator-, Migrations-, Skalierungs- und Browsertests bilden die
  Abschaltnachweise.
- Das UI zeigt den kurzen Grund weiterhin direkt; „Warum diese Empfehlung?“ öffnet ein
  überlagerndes Faktenpanel ohne Freigabesemantik oder Veränderung der Primäraktionen.
