# Technisches Datenschutz- und Verarbeitungsinventar V1

Status: Technische Grundlage vollständig; Betreiber- und Rechtsprüfung ausstehend.

Betroffene Anforderungen: Q-DSG-010 bis Q-DSG-040, V1120-DIA-010, V1120-DIA-030,
V1120-EXP-010, V1120-AUD-010, V1120-SEC-010 und V1120-OPS-010.

Dieses Inventar beschreibt den bis Release 1.11.0 tatsächlich implementierten Datenfluss. Die mit
V1120 gekennzeichneten Analysezeilen beschreiben ausschließlich den in WP0 vorgeschlagenen
Zielzustand und sind bis zur Freigabe und Umsetzung von WP1 bis WP4 nicht produktiv vorhanden. Das
Inventar ist keine Rechtsberatung und ersetzt weder den Auftragsverarbeitungsvertrag noch das vom
Verantwortlichen freizugebende Verzeichnis von Verarbeitungstätigkeiten.

## 1. Grundsatz und Zweck

Der Rundflug-Leitstand koordiniert anonymisierte Ticketgruppen, Ressourcen, Flugumläufe,
Warteinformationen und betriebliche Auditereignisse. Er führt keine Gastnamen, Telefonnummern,
Helferkonten, Pilotennamen, Lizenzdaten oder Flugbuchdaten. Eine rechtlich oder flugbetrieblich
notwendige Zuordnung realer Personen bleibt außerhalb des Systems.

Anonym im fachlichen Sinn bedeutet nicht automatisch, dass technisch keinerlei personenbezogene
oder pseudonyme Daten verarbeitet werden. Insbesondere Push-Endpunkte, öffentliche Ticketcodes,
Gerätekennungen, freie Bemerkungen sowie Infrastruktur-Metadaten können eine indirekte Zuordnung
ermöglichen.

## 2. Datenkategorien im Anwendungsschema

| Kategorie | Gespeicherte Angaben | Einordnung und Schutz |
| --- | --- | --- |
| Veranstaltung/Stammdaten | technische Event-ID, Datum, Flugplatz, Gates, Produkte, Preise, Flugzeuge | grundsätzlich Sach-/Betriebsdaten; Registrierungskennzeichen können mittelbar einem Halter zugeordnet werden |
| Tickets | zufällige interne ID, ausschließlich SHA-256-Hash des öffentlichen Codes, Status, Preis, Gewichtsklasse, optional Einzelgewicht | pseudonymer Vorgang; Klartextcode nur im Browser/QR-Ticket und nie im Audit oder Backup-Log |
| Ticket-/Fluggruppen | zufällige Gruppen-ID, Queuefolge, Produkt, Status, Zeitfenster, Umlaufbezug | pseudonyme operative Kohorte ohne Namen und Telefonnummern |
| Piloten | veranstaltungsbezogene technische ID, operatives Kürzel, optionale operative Notiz, Pause/Zuordnung | keine Namen; lokale Zuordnung außerhalb des Systems kann das Kürzel pseudonym machen |
| Geräte | technische Geräte-ID, frei wählbare technische Bezeichnung, Rolle, Aktivität, letzter Kontakt, Hash des Kopplungstokens | keine persönlichen Gerätenamen verwenden; Klartexttoken bleibt nur lokal im gekoppelten Browser |
| Audit/Idempotenz | Zeitpunkt, technische Geräte-ID, Kommando-/Ereignistyp, Aggregat-ID, fachlicher Payload, Begründung soweit erforderlich | append-only; niemals Namen, Telefonnummern, PINs, Ticketcodes oder freie personenbezogene Angaben eintragen |
| Web-Push | Ticket-ID, Push-Endpunkt, Browser-Schlüssel, Ursprung der Statusseite, Einwilligungs-, Lösch- und Zustellzeitpunkt | pseudonyme Online-Kontaktdaten; getrennte Tabellen, nicht Bestandteil portabler R2-Sicherungen |
| Prognose/Berichte | Zeitfenster, Prozessdauern, Auslastung, Zählwerte, besondere betriebliche Ereignisse | aggregierte bzw. pseudonyme Betriebsdaten; Rohdatenexport enthält keine Klartext-Ticketcodes |
| Planungsläufe | technische Event-, Ressourcen-, Gruppen-, Umlauf- und Lane-IDs, normalisierte Forecast-/Dispatch-/Voraufrufeingaben und -ausgaben, Versionen, Zeitstempel und Laufzeit | pseudonyme Betriebsdiagnose; inhaltsadressiert und dedupliziert, ohne öffentliche Codes/Hashes, Credentials, Konto-IDs, freie Texte oder Einzelgewichte |
| Diagnose-Momentaufnahme | sichere Board-Projektion, passender Planungslauf, Forecast-Snapshots und optionaler flüchtiger Allowlist-UI-Kontext | lokal heruntergeladene support-sichere Datei; enthält interne IDs und Betriebsbeziehungen, aber keine Sitzungen, Geräte-/Kontokennung, Push-Ziele oder vollständige Browserkennung |
| Tagesanalysepaket | sichere Endzustands-, Planungs-, Forecast-, Ereignis- und Berichtprojektionen; Archivstatus, ETag, Größe, Ablauf und getrennte Zugriffshistorie | private EU-R2-Datei und D1-Metadaten; keine öffentliche URL, kein Restore und keine rohen Tabellendumps |

## 3. Daten außerhalb des fachlichen D1-Schemas

Für die rechtliche Prüfung zusätzlich zu berücksichtigen:

- Cloudflare-Account-, Build-, Sicherheits-, Observability- und HTTP-Metadaten, insbesondere
  Zeitstempel und mögliche IP-/Request-Metadaten,
- GitHub-/CI-Metadaten der Entwicklung und Bereitstellung,
- Browser-, Betriebssystem- und Push-Dienst-Metadaten beim jeweiligen Push-Anbieter,
- die Betreiberadresse in `VAPID_SUBJECT`,
- lokale Browserdaten: Geräteschlüssel, aktives Event, Offline-Snapshot und Push-Zuordnung,
- ausschließlich flüchtiger Analyse-Ringpuffer mit höchstens 100 allowlist-basierten UI-Ereignissen;
  nicht in Web Storage oder IndexedDB persistiert,
- lokal heruntergeladene Diagnose- oder Tagesanalysedateien und deren Übertragung über einen
  betreiberseitig freizugebenden Supportkanal,
- außerhalb des Systems geführte Zuordnung eines Pilotenkürzels zu einer realen Person.

Die D1-/R2-/Durable-Object-EU-Jurisdiktion allein belegt nicht automatisch die ausschließliche
EU-Verarbeitung aller dieser Metadaten.

## 4. Speicherorte und Datenflüsse

```text
Browser/PWA
  ├─ HTTPS/WebSocket ─> Cloudflare Worker
  │                       ├─ D1 EU: Source of Truth, Audit, Push-Ziele
  │                       ├─ Durable Object EU: serialisierte Kommandos/Realtime
  │                       └─ R2 EU: portable Backups, Berichte und private Tagesanalysepakete,
  │                                  ohne Push-Ziele
  ├─ lokaler Download ─> support-sichere Diagnose-Momentaufnahme
  └─ Web Push ─────────> externer Browser-Push-Dienst ─> Besuchergerät
```

Die reale technische EU-Konfiguration ist in
`docs/verification/cloudflare-eu-runtime-v1.md` dokumentiert. Transport erfolgt ausschließlich per
HTTPS/WSS außerhalb der lokalen Entwicklung.

## 5. Löschung und Aufbewahrung

- Push-Ziele: konfigurierbar 1 bis 30 Tage nach Veranstaltungsende, Standard sieben Tage; täglicher
  Löschjob entfernt abgelaufene, widerrufene und technisch ungültige Einträge.
- Push-Zustellaufträge: werden zusammen mit dem Abonnement gelöscht.
- Portable R2-Sicherungen: automatischer Bestand mindestens 14 volle Tage; Push-Ziele sind
  ausgeschlossen.
- Tagesanalysepakete: getrennte Konfiguration `ANALYSIS_RETENTION_DAYS` im Bereich 14 bis 365;
  Entwicklung und Abnahme zunächst 30 Tage, Produktion erst nach OQ-18. Ablauf und manuelle
  Löschung entfernen das R2-Objekt, behalten aber minimale Archivmetadaten und das append-only
  Analysezugriffsprotokoll.
- Diagnose-Momentaufnahmen: keine serverseitige Langzeitkopie. Die lokal heruntergeladene Datei
  unterliegt dem freizugebenden Support- und Löschprozess des Verantwortlichen.
- Planungsläufe und deduplizierte Planungspayloads: Bestandteil der fachlichen Veranstaltung und
  der portablen Sicherung; Löschung zusammen mit der Veranstaltung beziehungsweise beim
  Werksreset. Eine davon abweichende fachliche Aufbewahrungsfrist bleibt Teil der allgemeinen
  Historienentscheidung.
- Gerätekopplung: Widerruf deaktiviert das Gerät und entfernt den Credential-Hash.
- Werkszustand: löscht D1-Anwendungsdaten, Durable-Object-Zustand und auf Wunsch R2-Sicherungen;
  standardmäßig wird vorher ein Wiederherstellungsbackup erzeugt.
- Fachliche Historie/Audit: Der konkrete betriebliche Aufbewahrungs- und spätere Löschzeitraum muss
  der Verantwortliche vor Produktion festlegen. Die technische Fünfjahresauslegung ist keine
  automatische rechtliche Aufbewahrungsentscheidung.
- Cloudflare-/CI-/Account-Logs: Fristen sind im jeweiligen Vertrag und Account zu prüfen und in das
  freigegebene Verzeichnis zu übernehmen.

## 6. Technische und organisatorische Maßnahmen

- keine Gastnamen oder Telefonnummern in Contracts, Schema, UI oder Testdaten,
- nicht aufzählbare Ticketcodes; in D1 ausschließlich deren SHA-256-Hash,
- Gerätekopplung mit zufälligem Token; serverseitig ausschließlich Credential-Hash,
- Administrator-PIN ausschließlich als Hash/Secret, niemals in D1 oder Logs,
- Rollenprüfung, erwartete Version, Idempotenz und append-only Audit für Schreibkommandos,
- TLS-Zwang, Security Header, Rate Limit für öffentliche Ticketabfragen,
- D1, R2 und Durable Object in EU-Jurisdiktion,
- getrennte, befristete Push-Tabellen und Ausschluss aus portablen Backups,
- ausschließlich strikt typisierte `SUPPORT_SAFE`-Allowlist-Projektionen für Analyseexporte,
- Secret-/Token-Canary-Tests für JSON, ZIP, R2-Metadaten, Dateinamen und Fehlerausgaben,
- private Worker-vermittelte R2-Downloads ohne öffentliche URL oder dauerhaft signierten Link,
- getrenntes append-only Analysezugriffsprotokoll ohne Klartext-Konto-ID und ohne Änderung der
  operativen Event-Version,
- flüchtiger Client-Ringpuffer ohne Cookies, Sessionobjekt, Web-Storage-Dump, freie Eingaben,
  vollständigen User Agent oder Fehlerstack,
- dokumentierter Backup-/Restore-, Offline-, Papier- und Werkszustandsprozess,
- keine Secrets, Klartext-Ticketcodes oder Push-Endpunkte in Protokollen.

## 7. Vom Verantwortlichen vor Produktivfreigabe auszufüllen

| Pflichtangabe/Entscheidung | Freigabestatus |
| --- | --- |
| Verantwortlicher: Name, Anschrift und Kontakt | offen |
| Datenschutzkontakt/Datenschutzbeauftragter, soweit erforderlich | offen |
| konkrete Zwecke und Rechtsgrundlage je Datenkategorie | offen |
| Kategorien betroffener Personen und Empfänger | offen |
| Cloudflare-Vertragspartner, DPA v6.4 und aktuelle Subprozessoren gemäß Datenschutzabnahme | offen |
| Push-Anbieter und mögliche Drittland-/Metadatenverarbeitung | offen |
| Frist für operative Historie, Audit und Account-/Observability-Logs | offen |
| Verfahren für Auskunft, Löschung, Sicherheitsvorfall und Betreiberwechsel | offen |
| Prüfung, ob Einzelgewicht trotz Pseudonymisierung besondere Schutzmaßnahmen erfordert | offen |
| Produktionswert für `ANALYSIS_RETENTION_DAYS` und Löschfreigabe gemäß OQ-18 | offen |
| Freigegebener Supportkanal, Empfängerkreis und lokaler Löschprozess für Analysepakete | offen |
| Datenschutzfreigabe des Profils `SUPPORT_SAFE` und der Freitext-Vorhandenseinsmetadaten | offen |
| Name/Version des freigegebenen Datenschutzhinweises in der PWA | offen |
| Datum, prüfende Person und Freigabeentscheidung | offen |

Q-DSG-040 bleibt bis zur dokumentierten Prüfung und Freigabe dieser Angaben sowie des realen
Cloudflare-Vertrags-/Subprozessorstands auf `in Arbeit`. Das verbindliche Prüfprotokoll liegt unter
`docs/operations/cloudflare-data-protection-acceptance-v1.md`.
