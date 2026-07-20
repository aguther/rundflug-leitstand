# Priorisierter V1-Backlog

Die Pakete sind in Abhängigkeitsreihenfolge priorisiert und liefern jeweils ein sichtbares,
überprüfbares Ergebnis. Die vollständige Einzelzuordnung aller 185 V1-Anforderungen steht in
`docs/requirements/traceability.csv`; die folgenden ID-Listen benennen die fachlichen Schwerpunkte.
Offene Fragen werden nicht als Annahmen entschieden.

## BP-01 – Traceability, offene Entscheidungen und Abnahmemodell

**Ziel/Ergebnis:** Formal und fachlich prüfbarer V1-Katalog mit Risikoregister, höchstens zwölf
blockierenden Fragen und durchgängiger Zuordnung zu Paketen und Tests.

- **Anforderungen:** alle 185 V1-IDs; besonders Q-WAR-050, T-080.
- **Abhängigkeiten:** keine.
- **Blocker:** keine; verwaltet OQ-01 bis OQ-12.
- **Akzeptanz:** 207 eindeutige YAML-/CSV-IDs; alle 166 V1-MUSS-IDs besitzen Paket und Testnachweis;
  `npm run requirements:verify` ist erfolgreich.

## BP-02 – Geräteidentität, Rollen und auditierte Kommandoannahme

**Ziel/Ergebnis:** Ein gekoppeltes Gerät darf ein rollenberechtigtes Kommando idempotent und
versionsgeprüft ausführen; alle Clients sehen erst den bestätigten Zustand.

- **Anforderungen:** F-ADM-030, F-ADM-040, F-ADM-050, F-EVT-010, F-EVT-020, F-EVT-030,
  F-EVT-040, F-INT-010, F-INT-070, D-080, D-090, Q-SIC-010, Q-SIC-020, Q-ZUV-010,
  Q-ZUV-030, Q-ZUV-040, T-090, T-100.
- **Abhängigkeiten:** BP-01.
- **Blocker:** OQ-12 für konkurrierende Rollen; OQ-06 vor Produktionsfreigabe.
- **Akzeptanz:** ungekoppelte/falsche Rollen werden abgelehnt; Doppel-Tipp bleibt einfach; stale write
  liefert Konflikt; Ledger, Zustand, Idempotenz und Outbox bleiben konsistent; Reconnect lädt Snapshot.

## BP-03 – Veranstaltung, Produkte, Ressourcengruppen und Zuordnungsinvarianten

**Ziel/Ergebnis:** Ein synthetisches Event mit Produkten, Gates, Piloten und zeitlich gültigen
Flugzeugzuordnungen ist administrierbar, ohne Doppelzuordnung zuzulassen.

- **Anforderungen:** F-RES-010 bis F-RES-090, F-FLT-010, F-FLT-020, F-FLT-040, F-ADM-010,
  F-ADM-020, F-ADM-080, F-ADM-100, D-010, D-015, D-016, D-020, D-060, D-070, D-100,
  Q-WAR-020, Q-WAR-040, T-060.
- **Abhängigkeiten:** BP-02.
- **Blocker:** keine für Stammdaten; OQ-07 für endgültige Historienaufbewahrung.
- **Akzeptanz:** Produkt verweist exakt auf eine Ressourcengruppe; mehrere Produkte teilen eine Queue;
  überlappende aktive Flugzeugzuordnung wird verständlich abgelehnt und auditiert.

## BP-04 – Erstes Vertical Slice: Verkauf bis abgeschlossener Umlauf

**Ziel/Ergebnis:** Eine synthetische Buchungsgruppe wird verkauft, erhält nicht erratbare QR-Tickets
und eine stabile Fluggruppe und durchläuft nach menschlicher Bestätigung `NEXT → IM FLUG → GELANDET →
ABGESCHLOSSEN`; operative und öffentliche Ansicht aktualisieren sich live.

- **Anforderungen:** F-KAS-010 bis F-KAS-060, F-KAS-090, F-KAS-120, F-KAS-160, F-SLT-010,
  F-SLT-030, F-SLT-040, F-BRD-010, F-BRD-020, F-BRD-040, F-BRD-060, F-BRD-070,
  F-BRD-080, F-BRD-100, F-BRD-110, F-BRD-120, D-030, D-040, D-045, D-050,
  F-PRG-010, F-PRG-020, F-BEN-010, Q-UX-010, Q-UX-020, Q-UX-040, Q-UX-050,
  Q-UX-060, Q-PER-010, Q-SIC-030.
- **Abhängigkeiten:** BP-02, BP-03.
- **Blocker:** OQ-02, OQ-09, OQ-10; Offline, Push, No-Show, Korrektur durch Storno/Neuverkauf und
  komplexe Optimierung folgen.
- **Akzeptanz:** Verkauf unter sechs Interaktionen; vier Primäraktionen; `GELANDET` gibt das Flugzeug
  nicht frei; Plan/Prognose/Ist bleiben getrennt; Doppel-Tipps und stale writes erzeugen keine Dublette.

## BP-05 – Queue, Fluggruppenbildung, Gruppenschutz und Sonderfälle

**Ziel/Ergebnis:** Gemeinsame Ressourcengruppen-Queue disponiert mehrere Produkte nach
Verkaufsreihenfolge; Gruppen, No-Show, Nachbesetzung, Zurückstellung sowie Storno/Neuverkauf bleiben
explizit und auditiert.

- **Anforderungen:** F-KAS-070, F-KAS-080, F-SLT-020, F-SLT-050 bis F-SLT-120, F-BRD-025,
  F-BRD-030, F-BRD-050, F-BRD-085, F-BRD-090, F-BRD-160, D-040, D-045, D-050.
- **Abhängigkeiten:** BP-04.
- **Blocker:** OQ-02, OQ-03, OQ-04.
- **Akzeptanz:** keine automatische Gruppentrennung; nach `NEXT` nur bestätigte Änderung; Ticket ist
  höchstens einem offenen Umlauf zugeordnet; Korrekturen erfolgen als neue Ereignisse.

## BP-06 – Prognose, Mehrflugzeug-Disposition und Kapazität

**Ziel/Ergebnis:** Reale Ereignisse disponieren alle offenen Fluggruppen neu und erzeugen interne
Zeitpunkte sowie ehrliche öffentliche Fenster und konservative Verkaufsempfehlungen.

- **Anforderungen:** F-PRG-010 bis F-PRG-130, F-KAP-010 bis F-KAP-060, D-055, Q-PER-030.
- **Abhängigkeiten:** BP-03 bis BP-05.
- **Blocker:** OQ-04, OQ-05.
- **Akzeptanz:** Kaltstart, Messwertgewichtung, Ausreißerbehandlung und Unsicherheit sind deterministisch
  dokumentiert; Verzögerung kaskadiert ohne manuelle Folgezeitpflege; Vollrechnung bleibt unter 2 s.

## BP-07 – Besucherstatus, zwei FIDS-Profile, automatischer Voraufruf und Web-Push

**Ziel/Ergebnis:** Ticketstatus, deutsches Standard-FIDS und vollständig englisches Terminal-FIDS
zeigen denselben datensparsamen Livezustand. Das System setzt geeignete Gruppen automatisch auf
`GO_TO_GATE`; `NEXT` bleibt menschlich bestätigt. Web-Push kann je Ticket mit dokumentierter
Einwilligung aktiviert werden.

- **Anforderungen:** F-BEN-010 bis F-BEN-040, F-BEN-090, F-BEN-100, F-MON-010 bis
  F-MON-050, F-MON-070, D-110, Q-DSG-010, Q-DSG-030, Q-SIC-030, Q-SIC-040, Q-UX-080, T-040.
- **Abhängigkeiten:** BP-02, BP-04, BP-06.
- **Blocker:** OQ-05, OQ-06, OQ-11.
- **Akzeptanz:** keine Namen/Interna öffentlich; Ticketcodes nicht aufzählbar; Reconnect ohne
  Bedienung; Terminalprofil vollständig Englisch; `DEPARTED` verschwindet nach konfigurierter Zeit nur
  aus der Anzeige; Unsicherheit handlungsorientiert; Einwilligung mit Zeitpunkt und Kanal nachweisbar.

## BP-08 – Unterbrechung, Notfallmodus, Tanken und Pausen

**Ziel/Ergebnis:** Blockierungen wirken sofort und nur im gewählten Geltungsbereich; optionale
Pausendauern verbessern die Prognose ohne automatische Freigabe. Not-Halt stoppt Verkauf/Aufrufe,
lässt laufende Flüge aber dokumentierbar.

- **Anforderungen:** F-WET-010 bis F-WET-040, F-NOT-010 bis F-NOT-040, F-FLT-030,
  F-FLT-050, F-FLT-060, F-FLT-080, F-FLT-090, D-065, F-KAP-040.
- **Abhängigkeiten:** BP-04, BP-06, BP-07.
- **Blocker:** OQ-01 für Offline-Verhalten.
- **Akzeptanz:** nicht betroffene Gruppen laufen weiter; laufender Flug kann landen/abschließen; Aufhebung
  nur per Admin-PIN; Hinweise besitzen keine Sicherheitsfreigabesemantik.

## BP-09 – Offline-Queue, Wiederverbindung und Konfliktauflösung

**Ziel/Ergebnis:** Der letzte bestätigte Stand übersteht mindestens 60 Sekunden Verbindungsabbruch.
Operative Kommandos bleiben gesperrt; ausschließlich vorbereitende lokale Kassenentwürfe bleiben
erhalten und werden nach Wiederverbindung bewusst neu bestätigt.

- **Anforderungen:** T-035, Q-ZUV-020, Q-ZUV-030, Q-ZUV-040, Q-ZUV-070, F-EVT-020, F-INT-070.
- **Abhängigkeiten:** BP-02, BP-04, BP-05, BP-08.
- **Blocker:** OQ-01, OQ-08, OQ-12.
- **Akzeptanz:** veralteter Snapshot ist gekennzeichnet; Server-/D1-Fehler leeren ihn nicht;
  Wiederholung bestätigter Kommandos ist idempotent; Konflikt zeigt Serverzustand; kein manueller
  Neustart; Papier-Nacherfassung ist nachvollziehbar.

## BP-10 – Administration, Historie, Berichte und Datenschutzlöschung

**Ziel/Ergebnis:** Berechtigte Rollen pflegen Stammdaten in einer kompakten Tabelle-mit-Editor-
Oberfläche, durchsuchen Audit/Historie, exportieren Tagesdaten und löschen personenbezogene
Benachrichtigungsdaten fristgerecht. Operative Flottensteuerung erfolgt im Supervisor und in der
mobilen Assist-Ansicht.

- **Anforderungen:** F-ADM-010, F-ADM-020, F-ADM-060, F-ADM-080, F-ADM-090, F-HIS-010 bis
  F-HIS-040, F-HIS-060, F-HIS-070, F-KAS-130, Q-DSG-020, D-090, Q-WAR-050.
- **Abhängigkeiten:** BP-02 bis BP-09.
- **Blocker:** OQ-02, OQ-07.
- **Akzeptanz:** Filter/CSV/PDF stimmen mit Ledger überein; Kennzahlen haben definierte Ereignisgrenzen;
  Liveänderungen zeigen Auswirkungen; Löschung ist wiederholbar und auditiert.

## BP-11 – Backup, Restore, Betriebsunterlagen und Umgebungen

**Ziel/Ergebnis:** Getrennte Abnahme/Produktion, portables EU-Backup und dokumentierter Wiederanlauf
einschließlich Papierfallback sind betreibbar und übergabefähig.

- **Anforderungen:** T-030, T-050, T-070, T-080, Q-DSG-040, Q-WAR-010, Q-WAR-030,
  Q-ZUV-060, Q-ZUV-070.
- **Abhängigkeiten:** BP-03, BP-09, BP-10.
- **Blocker:** OQ-06, OQ-07, OQ-08, OQ-10.
- **Akzeptanz:** täglicher und Vorveranstaltungs-Export mit Prüfsumme/14 Tagen; isolierter Restore unter
  30 Minuten; Runbooks und Ressourceninhaberschaft geprüft.

## BP-12 – Abnahmesimulation und Generalprobe

**Ziel/Ergebnis:** Der vollständige V1-Umfang besteht den simulierten Veranstaltungstag und die
Generalprobe mit Originalhardware.

- **Anforderungen:** alle V1-IDs; besonders Q-PER-020, Q-ZUV-050, Q-UX-060, T-010, T-020.
- **Abhängigkeiten:** BP-01 bis BP-11.
- **Blocker:** alle dann noch offenen OQ; besonders OQ-08, OQ-09, OQ-11.
- **Akzeptanz:** drei Flugzeuge, zwei Ressourcengruppen, drei Produkte, 60 Tickets und 20 Umläufe;
  Standard- und Störfälle, 60-s-Ausfall, Restore, 12-h-Lauf, Browser-/Hardwareprüfung und alle
  messbaren Kriterien aus Abschnitt 13 bestehen.

## Spätere Stufen und Architekturgrenzen

V2–V4 werden nicht implementiert. Ihre Anforderungen verbleiben in der Traceability mit `Status=geplant`
und werden den Architekturpaketen zugeordnet, damit Bondrucker/SMS/Mehr-Gate, ADS-B/Passagierlisten und
Mandantenfähigkeit den V1-Kern später nicht erzwingen umzubauen.
