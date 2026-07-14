# Feldabnahme V1: Bedienbarkeit, Geräte und Browser

Status: Durchführungsprotokoll vorbereitet; Abnahme auf Originalhardware ausstehend.

Betroffene Anforderungen: F-KAS-010, Q-UX-010, Q-UX-020, Q-UX-030, Q-UX-040, Q-UX-060,
T-020 sowie die Generalprobe aus Kapitel 12 der Anforderungen.

## 1. Verbindliche Testbasis

Die Abnahme verwendet ausschließlich synthetische, anonyme Ticket- und Piloten-IDs. Vor Beginn
wird ein portables Backup angelegt. Migrationen und Deployment sind eingefroren; am Abnahmetag
findet keine geplante Wartung statt.

Hardware- und Browserbasis gemäß OQ-11:

| Geräteklasse | Mindestgerät | Browser |
| --- | --- | --- |
| Android-Tablet | ab 10 Zoll, 1920 × 1200, 4 GB RAM, Kamera | letzte und vorletzte Chrome-Hauptversion |
| iPad | ab 10,2 Zoll, Kamera | letzte und vorletzte Safari-Hauptversion |
| Windows-PC/Tablet | ab 1366 × 768, 4 GB RAM, Kamera | letzte und vorletzte Edge- und Chrome-Hauptversion |
| Öffentlicher Monitor | reale Kiosk-Hardware | produktiv vorgesehener Browser im Vollbild-Autostart |

Die konkreten Hersteller, Modelle, Betriebssystem- und Browserversionen werden im Ergebnisprotokoll
festgehalten. Emulatoren dürfen vorbereitend verwendet werden, zählen aber nicht als
Originalhardware-Abnahme.

## 2. Vorbereitung

1. Zentrale Cloudflare-Umgebung und D1-Migrationsstand prüfen.
2. Eine synthetische Veranstaltung mit mindestens zwei Gates, zwei Ressourcengruppen, zwei
   Produkten, drei Flugzeugen und drei Piloten-IDs vorbereiten.
3. Je ein ADMIN-, CASHIER- und FLIGHT_LINE-Gerät koppeln; FIDS und öffentliches Ticketgerät öffnen.
4. Web-Push auf mindestens einem echten Android- oder iOS-Gerät erlauben und Testzustellung prüfen.
5. Light und Dark Theme sowie Hoch- und Querformat vorbereiten.
6. Papierfallback, Offline-Anweisung und Rückkehr ins Netz bereitlegen.

## 3. Kassenmessung F-KAS-010

Nach höchstens zehn Minuten Einweisung führt jede Testperson 30 Standardverkäufe aus. Ein
Standardverkauf beginnt mit der Auswahl des Produkts und endet mit der sichtbaren QR-Ticketgruppe.
Freiwillige Zusatzinformationen und die Zeit zum physischen Kassieren werden nicht gemessen.

Zu protokollieren sind je Verkauf:

- anonymes Laufkürzel 01 bis 30,
- Dauer in Sekunden,
- Anzahl Interaktionen,
- Fehlbuchung ja/nein,
- notwendige Hilfe ja/nein,
- Gerät, Browser und Theme.

Bestanden ist die Messung nur, wenn:

- der Median unter 15 Sekunden liegt,
- mindestens 27 von 30 Verkäufen unter 15 Sekunden liegen,
- kein Verkauf mehr als sechs Interaktionen benötigt,
- keine Fehlbuchung auftritt,
- eine Kinderbuchung ohne Begleitung den organisatorischen Hinweis deutlich zeigt, sofern das
  Testprodukt die Begleitpflicht aktiviert hat.

## 4. Rollenabläufe innerhalb von zehn Minuten Einweisung

Jede Testperson erhält nur die zu ihrer Rolle gehörende Kurzanweisung und muss anschließend ohne
Eingriff der Testleitung ausführen:

### Kasse

- Standardgruppe verkaufen und QR-Codes aufrufen,
- bestehendes Ticket suchen,
- Storno beziehungsweise Korrektur auslösen,
- Offlinezustand erkennen und nach Wiederverbindung den bestätigten Stand unterscheiden.

### Flight Line

- nächste Gruppe aufrufen, Boarding und Flugzustände fortschreiben,
- Flugzeug flexibel bestätigen,
- Landung und Verfügbarkeit getrennt erfassen,
- Blockierung und Pilotpause erkennen,
- eine nach `IM FLUG` notwendige Manifestkorrektur ausschließlich über den administrativen
  Sonderweg durchführen.

### Administration

- Stammdatum anlegen, ändern und vor Betriebsbeginn löschen,
- Gerät koppeln und widerrufen,
- Backup auslösen,
- sicheren Neustart und Werkszustand erklären, ohne den destruktiven Schritt versehentlich
  auszuführen.

### Öffentliche Anzeige

- FIDS in den Vollbildmodus bringen,
- automatische Aktualisierung und Wiederverbindung prüfen,
- öffentlichen QR-Code öffnen und ausschließlich Zeitfenster beziehungsweise Wartepositionen
  erkennen, niemals garantierte Uhrzeiten.

Bestanden ist eine Rolle, wenn alle Schritte fachlich korrekt, ohne sicherheitsbezogene
Freigabeinterpretation und ohne mehr als einen neutralen Hinweis der Testleitung abgeschlossen
werden.

## 5. Visuelle und responsive Prüfung

Auf jedem Gerät werden mindestens Kasse, Flight Line, Administration, FIDS und Ticketstatus in
Light und Dark geprüft:

- keine horizontale Seitenverschiebung oder abgeschnittene Primäraktion,
- große, eindeutig erreichbare Touch-Ziele,
- höchstens eine hervorgehobene Primäraktion je Arbeitszustand,
- verständliche deutsche Begriffe statt interner Codes,
- konsistente Statusfarbe plus Text/Symbol; Farbe ist nie alleiniger Informationsträger,
- lesbarer Text, Fehler, Placeholder, Fokus und deaktivierter Zustand,
- Dialogfokus liegt beim ersten sinnvollen Eingabefeld; Formulare lassen sich mit Enter auslösen,
- Tabellen und Arbeitsbereiche springen bei unterschiedlichen Datenmengen nicht in der Breite.

## 6. Netz- und Wiederanlaufprobe

1. Während eines vorbereiteten Vorgangs Netzwerk trennen.
2. Offline-/veralteten Zustand sichtbar bestätigen.
3. Zulässige lokale Aktion erfassen; keine doppelte operative Zustandsänderung erzeugen.
4. Netzwerk wiederherstellen und automatische Realtime-Wiederverbindung beobachten.
5. Konflikt absichtlich mit einem zweiten Gerät erzeugen und prüfen, dass kein stale write still
   überschrieben wird.
6. Öffentlichen Monitor ohne manuellen Eingriff wieder auf aktuellen Stand kommen lassen.

## 7. Ergebnisprotokoll

### Vorbereitender automatisierter Browsernachweis vom 14.07.2026

Dieser Nachweis ersetzt die geforderte Originalhardware- und Helferabnahme nicht, reduziert aber
deren offenes Risiko. Geprüft wurde lokal mit synthetischem Seed gegen den realen Worker-/D1-Pfad:

- 30 aufeinanderfolgende Standardverkäufe: Median 581 ms, Maximum 843 ms, alle 30 unter 15 Sekunden,
  höchstens zwei Interaktionen und bei jedem Lauf ein neuer sichtbarer Beleg;
- Flight-Line-Aktion `NEXT`: kein Bestätigungsdialog, Zustandswechsel nach 534 ms, sichtbare
  Rückgängig-Aktion und Wiederherstellung nach 309 ms;
- Administration: PIN-Dialog setzt den Fokus unmittelbar in das Passwortfeld;
- responsive Vorprüfung bei 430 × 900 und 1280 × 720 ohne horizontalen Seitenüberlauf;
- sichtbare Bedienelemente der geprüften Kernabläufe mindestens 44 px groß;
- je geprüftem Arbeitsbereich eine hervorgehobene Hauptaktion sowie deutsche Status- und
  Prognosebegriffe statt interner Codes;
- keine relevanten Browser-Konsolenfehler in den geprüften lokalen Abläufen.

Offen und deshalb weiterhin ausdrücklich durch dieses Protokoll abzunehmen sind Originalhardware,
Sonnenlichtkontrast, Safari/iPadOS, Chrome/Android, Edge/Windows, Web-Push auf realen Geräten und die
selbstständige Bedienung durch Helfer nach höchstens zehn Minuten Einweisung.

### Verbindliches Abnahmeergebnis

Das unterschriebene Ergebnis enthält:

- Datum, Ort und anonymisierte Testpersonen-Kürzel,
- vollständige Hardware-/OS-/Browsermatrix,
- Rohzeiten der 30 Kassenverkäufe und berechneten Median,
- Ergebnis jeder Rollen-, Theme-, Orientierungs- und Netzprobe,
- gefundene Abweichung mit Schweregrad und Reproduktionsweg,
- Verweis auf Deployment-Version, D1-Migrationsstand und Backup-ID,
- Entscheidung `bestanden`, `bestanden mit Auflagen` oder `nicht bestanden`.

Anforderungen bleiben bei fehlender Durchführung oder offenen hohen/kritischen Abweichungen auf
`geplant`.
