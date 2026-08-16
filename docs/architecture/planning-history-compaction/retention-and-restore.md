# Retention-, Integritäts- und Restore-Regeln

## Datenbesitz und Fristen

| Bestand | Autoritative Ablage | Frist | Löschbedingung |
| --- | --- | --- | --- |
| heißer Planungsdetailbestand | D1 | 24–168 Stunden, Standard 24 | ausschließlich nach verifiziertem R2-Paket |
| kaltes Planungshistoriensegment | privates EU-R2 | 5–10 Kalenderjahre, Standard 5 | Ablauf plus erfolgreicher Objektlöschung und Lebenszyklusbeleg |
| Kompaktionskatalog | D1 | mindestens bis Paketlöschung | Veranstaltungslöschung, Werksreset oder belegter Retention-Lauf |
| Kompaktionsereignisse | D1, append-only | mindestens bis Paketlöschung | nur kontrollierter Lebenszykluspfad |
| Maintenance-Control | D1, transient | nur während einer begrenzten Pruning-/Restore-Transaktion | immer deaktivieren; nie im portablen Backup |

Die Produktionswerte werden explizit als `PLANNING_DETAIL_RETENTION_HOURS` und
`PLANNING_HISTORY_RETENTION_YEARS` gesetzt. Ein R2-Lifecycle darf später oder gleich streng löschen,
ersetzt aber nie den katalogisierten Anwendungslauf.

## Prüfkette

1. Der Builder zählt die vier Projektionen und friert Segmentgrenze und Fortsetzungsbeleg ein.
2. Jede NDJSON-Datei wird beim Streamen gezählt und gehasht.
3. Das gesamte ZIP wird inkrementell gehasht und unter einem unveränderlichen Schlüssel abgelegt.
4. Eine getrennte Sidecar-Datei bindet die ZIP-Prüfsumme an diesen Schlüssel.
5. Der Worker lädt das ZIP erneut aus R2, berechnet SHA-256 erneut und vergleicht Größe und Sidecar.
6. Erst danach wechselt der Katalog zu `VERIFIED`; erst dieser Zustand erlaubt Pruning.

## Isolierter Restore

Der Restore ist eine Recovery-Prozedur, keine Anwendungsschnittstelle:

1. neue isolierte D1 mit Baseline sowie `0002` und `0003` anlegen;
2. portables Backup Format 1 oder 2 einspielen und Fremdschlüssel prüfen;
3. katalogisierte Pakete nach Segmentzeit chronologisch bereitstellen;
4. ZIP-, Manifest- und Dateihashes sowie Zeilenmengen prüfen;
5. Runs, Contexts, Chunks und Snapshots idempotent laden;
6. katalogisierte Boundary-Links unter dem eng begrenzten Maintenance-Control rekonstruieren;
7. `PRAGMA foreign_key_check`, Mengenbilanz und vollständigen Replay ausführen;
8. Prüfergebnis sichern und erst danach über eine bewusste Betriebsentscheidung ein Binding ändern.

Die CLI `npm run planning-history:restore -- --isolated-database <path> --package <zip>` verweigert
offensichtliche Wrangler-/Produktionspfade. Der automatisierte Nachweis
`npm run test:planning-history-restore` enthält zusätzlich einen manipulierten Paketfall.

## Forward-Repair

Migration `0003` wird in einer laufenden D1 nicht zurückgerollt. Bei einem fehlgeschlagenen Build
bleibt die operative Historie erhalten. Bei einer Unterbrechung nach dem ZIP-Upload wird dessen Hash
erneut aus R2 berechnet und die fehlende Sidecar-Datei ergänzt. Ein einzelnes Sidecar ohne ZIP, ein
Hashfehler oder ein unklarer Boundary-Zustand stoppt die Löschung. Support korrigiert dann
Katalog/Objekt in einer isolierten Kopie oder stellt aus portablem Backup und verifizierten Paketen
in eine neue D1 wieder her.
