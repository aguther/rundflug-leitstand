# Technisches Datenschutz- und Verarbeitungsinventar V1

Status: Technische Grundlage vollständig; Betreiber- und Rechtsprüfung ausstehend.

Betroffene Anforderungen: Q-DSG-010 bis Q-DSG-040.

Dieses Inventar beschreibt den tatsächlich implementierten Datenfluss. Es ist keine Rechtsberatung
und ersetzt weder den Auftragsverarbeitungsvertrag noch das vom Verantwortlichen freizugebende
Verzeichnis von Verarbeitungstätigkeiten.

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
| Web-Push | Ticket-ID, Push-Endpunkt, Browser-Schlüssel, Einwilligungs-, Lösch- und Zustellzeitpunkt | pseudonyme Online-Kontaktdaten; getrennte Tabellen, nicht Bestandteil portabler R2-Sicherungen |
| Prognose/Berichte | Zeitfenster, Prozessdauern, Auslastung, Zählwerte, besondere betriebliche Ereignisse | aggregierte bzw. pseudonyme Betriebsdaten; Rohdatenexport enthält keine Klartext-Ticketcodes |

## 3. Daten außerhalb des fachlichen D1-Schemas

Für die rechtliche Prüfung zusätzlich zu berücksichtigen:

- Cloudflare-Account-, Build-, Sicherheits-, Observability- und HTTP-Metadaten, insbesondere
  Zeitstempel und mögliche IP-/Request-Metadaten,
- GitHub-/CI-Metadaten der Entwicklung und Bereitstellung,
- Browser-, Betriebssystem- und Push-Dienst-Metadaten beim jeweiligen Push-Anbieter,
- die Betreiberadresse in `VAPID_SUBJECT`,
- lokale Browserdaten: Geräteschlüssel, aktives Event, Offline-Snapshot und Push-Zuordnung,
- außerhalb des Systems geführte Zuordnung eines Pilotenkürzels zu einer realen Person.

Die D1-/R2-/Durable-Object-EU-Jurisdiktion allein belegt nicht automatisch die ausschließliche
EU-Verarbeitung aller dieser Metadaten.

## 4. Speicherorte und Datenflüsse

```text
Browser/PWA
  ├─ HTTPS/WebSocket ─> Cloudflare Worker
  │                       ├─ D1 EU: Source of Truth, Audit, Push-Ziele
  │                       ├─ Durable Object EU: serialisierte Kommandos/Realtime
  │                       └─ R2 EU: portable Backups und Berichte, ohne Push-Ziele
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
- dokumentierter Backup-/Restore-, Offline-, Papier- und Werkszustandsprozess,
- keine Secrets, Klartext-Ticketcodes oder Push-Endpunkte in Protokollen.

## 7. Vom Verantwortlichen vor Produktivfreigabe auszufüllen

| Pflichtangabe/Entscheidung | Freigabestatus |
| --- | --- |
| Verantwortlicher: Name, Anschrift und Kontakt | offen |
| Datenschutzkontakt/Datenschutzbeauftragter, soweit erforderlich | offen |
| konkrete Zwecke und Rechtsgrundlage je Datenkategorie | offen |
| Kategorien betroffener Personen und Empfänger | offen |
| Cloudflare-Vertragspartner, AVV/DPA und aktuelle Subprozessoren | offen |
| Push-Anbieter und mögliche Drittland-/Metadatenverarbeitung | offen |
| Frist für operative Historie, Audit und Account-/Observability-Logs | offen |
| Verfahren für Auskunft, Löschung, Sicherheitsvorfall und Betreiberwechsel | offen |
| Prüfung, ob Einzelgewicht trotz Pseudonymisierung besondere Schutzmaßnahmen erfordert | offen |
| Name/Version des freigegebenen Datenschutzhinweises in der PWA | offen |
| Datum, prüfende Person und Freigabeentscheidung | offen |

Q-DSG-040 bleibt bis zur dokumentierten Prüfung und Freigabe dieser Angaben sowie des realen
Cloudflare-Vertrags-/Subprozessorstands auf `geplant`.
