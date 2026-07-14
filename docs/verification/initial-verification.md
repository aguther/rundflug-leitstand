# Verifikationsstand V1

Stand: 14.07.2026

Dieses Dokument ist der Einstieg in die technischen V1-Nachweise. Ein grüner automatisierter
Projektcheck belegt die implementierten Fach- und Infrastrukturpfade, ersetzt aber nicht die
ausdrücklich geforderte Generalprobe mit Originalhardware.

## Erfolgreiche automatisierte Prüfungen

```text
npm run check
```

Zuletzt erfolgreich am 14. Juli 2026:

- Biome-Prüfung von 119 Dateien,
- TypeScript-Prüfung aller sechs Workspaces,
- 39 Testdateien mit 201 Tests,
- React-/PWA-Produktionsbuild einschließlich Service Worker,
- Cloudflare-Worker-Dry-Run mit D1-, Durable-Object-, R2- und Rate-Limit-Bindings,
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
- Backup/Restore, Berichte, Transport-Sicherheit und EU-Adapterkonfiguration.

Detailnachweise liegen thematisch in diesem Verzeichnis, unter anderem:

- [command-pipeline-v1.md](command-pipeline-v1.md)
- [vertical-slice-v1.md](vertical-slice-v1.md)
- [master-data-v1.md](master-data-v1.md)
- [fleet-operations-v1.md](fleet-operations-v1.md)
- [public-monitors-v1.md](public-monitors-v1.md)
- [operational-exceptions-v1.md](operational-exceptions-v1.md)
- [cloudflare-eu-runtime-v1.md](cloudflare-eu-runtime-v1.md)
- [soak-reliability-v1.md](soak-reliability-v1.md)
- [cloudflare-availability-v1.md](cloudflare-availability-v1.md)

## Laufende technische Abnahmen

- Q-ZUV-050: Der korrigierte ungekürzte 12-Stunden-Langlauf läuft seit 14. Juli 2026, 17:44 Uhr.
- Q-ZUV-060: Der 12-Stunden-Monitor der zentralen Cloudflare-Umgebung läuft seit
  14. Juli 2026, 08:18 Uhr.
- D1-Migrationen 0030 und 0031 müssen in der zentralen Umgebung noch angewendet werden.

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
