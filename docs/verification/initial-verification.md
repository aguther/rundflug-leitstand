# Verifikationsstand V1

Stand: 15.07.2026

Dieses Dokument ist der Einstieg in die technischen V1-Nachweise. Ein grüner automatisierter
Projektcheck belegt die implementierten Fach- und Infrastrukturpfade, ersetzt aber nicht die
ausdrücklich geforderte Generalprobe mit Originalhardware.

## Erfolgreiche automatisierte Prüfungen

```text
npm run check
```

Zuletzt erfolgreich am 15. Juli 2026, parallel zum isolierten 12-Stunden-Langlauf:

- Biome-Prüfung von 140 Dateien,
- TypeScript-Prüfung aller sechs Workspaces,
- 50 Testdateien mit 236 Tests,
- React-/PWA-Produktionsbuild einschließlich Service Worker,
- Cloudflare-Worker-Dry-Run mit D1-, Durable-Object-, R2- und Rate-Limit-Bindings,
- 15 sequenziell ausgeführte Worker-/D1-Integrationssuiten für die zentralen V1-Abläufe,
- isolierter Backup-Restore mit Prüfsumme und Fremdschlüsseln,
- Architektur- und Dokumentationsprüfung,
- 199 eindeutige Anforderungen sowie 176 zugeordnete V1-Anforderungen verifiziert.

Die Tests decken insbesondere ab:

- anonyme QR-Tickets, Gruppenbindung, Queue und Verkaufsschutz,
- Flight-Line-Zustände, Flugzeug-/Piloten-ID-Konflikte und Prognosen,
- append-only Audit, Idempotenz und Ablehnung veralteter Schreibstände,
- Offline-Wiederanlauf, Notbetrieb und Realtime-Verteilung,
- Stammdaten, Administrationsgeräte, Setup, Neustart und Werkszustand,
- öffentliche Monitore, Ticketstatus, Web-Push-Verträge und Zugriffsbegrenzung,
- Backup/Restore, Berichte, Transport-Sicherheit und EU-Adapterkonfiguration,
- vollständiger SQL-Migrationsguard gegen Gast-/Passagiernamen, Telefon-/Kontaktfelder und
  im Klartext gespeicherte öffentliche Ticketcodes.

## Browserprüfung der Administration

Am 15. Juli 2026 wurde die Produktpflege zusätzlich im lokalen Browser mit synthetischen Daten
geprüft:

- Produktanlage mit deutschem Euro-Preisformat,
- einmalige PIN-Abfrage mit automatischem Eingabefokus und Bestätigung per Eingabetaste,
- anschließende protokollierte Speicherung und Anzeige in der Stammdatentabelle,
- direkt bedienbarer Begleithinweis für Kinder mit automatischer Auswahl der Gewichtsklasse
  `CHILD`,
- kontextuelle, aufklappbare Feldhilfe im Produkteditor,
- Dark-Mode-Kontrast sowie Desktop- und 430-Pixel-Mobilansicht ohne horizontalen Überlauf.

Die produktübergreifenden Hilfetexte wurden außerdem als wiederverwendbare Feldkomponente in die
sinnvollen Eingaben von Einrichtung, Stammdaten, Betrieb, Geräteverwaltung, Historie und Reset
integriert. Die Hilfe bleibt standardmäßig geschlossen und überlagert den normalen Arbeitsablauf
nicht.

Detailnachweise liegen thematisch in diesem Verzeichnis, unter anderem:

- [command-pipeline-v1.md](command-pipeline-v1.md)
- [vertical-slice-v1.md](vertical-slice-v1.md)
- [v1-acceptance-day.md](v1-acceptance-day.md)
- [master-data-v1.md](master-data-v1.md)
- [fleet-operations-v1.md](fleet-operations-v1.md)
- [public-monitors-v1.md](public-monitors-v1.md)
- [operational-exceptions-v1.md](operational-exceptions-v1.md)
- [cloudflare-eu-runtime-v1.md](cloudflare-eu-runtime-v1.md)
- [soak-reliability-v1.md](soak-reliability-v1.md)
- [cloudflare-availability-v1.md](cloudflare-availability-v1.md)

## Laufende technische Abnahmen

- BP-12: Der automatisierte V1-Abnahmetag mit drei Flugzeugen, zwei Ressourcengruppen, drei
  Produkten, 60 Tickets und 20 vollständigen Umläufen wurde erfolgreich abgeschlossen.
- Q-ZUV-050: Nach einem nicht verwertbaren, vom ausführenden Prozess getrennten Start läuft der
  überwachte ungekürzte 12-Stunden-Langlauf seit 15. Juli 2026, 05:54 Uhr. Ein unmittelbar zuvor
  ausgeführter 30-Sekunden-Kontrolllauf bestand 15 Zyklen, 75 Requests und 30
  Realtime-Zustandsänderungen ohne Trennung oder Worker-Neustart. Der parallele vollständige
  Projektcheck löste im isolierten Worker keinen Neustart aus.
- Q-ZUV-060: Der 12-Stunden-Monitor der zentralen Cloudflare-Umgebung wurde am 14. Juli 2026 mit
  720/720 verfügbaren Intervallen und 100 Prozent erfolgreich abgeschlossen.
- D1-Migrationen 0030 und 0031 wurden am 15. Juli 2026 erfolgreich in der zentralen Umgebung
  angewendet. Vorher wurde ein D1-Export unter
  `migration-backups/2026-07-15/pre-0030-0031-20260715-000428.sql` im EU-R2-Bucket abgelegt und per
  SHA-256-Rückprüfung verifiziert. Wrangler meldet anschließend `No migrations to apply`; Health,
  Setup, öffentliches FIDS und Administration antworteten jeweils mit HTTP 200.
- Der öffentliche Web-Push-Konfigurationsendpunkt der zentralen Umgebung antwortete am 15. Juli
  2026 noch mit `503 PUSH_NOT_CONFIGURED`. Die Anwendung unterstützt Web-Push vollständig, für den
  realen Betrieb müssen jedoch noch die VAPID-Secrets mit `npm run cloudflare:configure-push`
  gesetzt und anschließend auf einem echten Besuchergerät geprüft werden.

Ergebnisse dürfen erst nach vollständigem, erfolgreichem Abschluss in der Traceability als
`umgesetzt` markiert werden.

## Noch erforderliche Abnahmen außerhalb der Automatisierung

- Usability- und Verkaufsmessung je Helferrolle nach
  [field-acceptance-v1.md](field-acceptance-v1.md),
- Browser-/Gerätematrix mit echter Android-, iPad- und Windows-Hardware,
- Generalprobe am Veranstaltungsort einschließlich Kiosk, Web-Push und Offlineverfahren,
- dokumentierter AVV/DPA-, Subprozessor- und EU-Metadaten-Nachweis,
- getrennte Abnahme- und Produktivumgebung vor dem echten Produktionsbetrieb,
- ausdrückliche Lizenz-/Nutzungsrechts- und Betreiberübergabeentscheidung.

Diese Punkte sind echte Abnahmereste und werden nicht durch Unit- oder Integrationstests ersetzt.
