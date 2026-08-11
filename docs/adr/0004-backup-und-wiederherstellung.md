# ADR-0004: Zweistufige Sicherung

- Status: Akzeptiert und umgesetzt
- Datum: 2026-07-11
- Ergänzt: 2026-08-11

## Entscheidung

D1 Time Travel dient der schnellen Wiederherstellung. Zusätzlich wird täglich und vor
Veranstaltungstagen ein portabler Export mit Prüfsumme in einem EU-R2-Bucket abgelegt. Exporte werden
mindestens 14 Tage aufbewahrt. Ein Restore in eine isolierte Datenbank wird regelmäßig getestet.

Portable Exporte werden ab Formatversion 2 nicht mehr als ein vollständig im Worker gepuffertes
JSON-Objekt erzeugt. Der Worker schreibt ein ZIP-Archiv mit `manifest.json` und einer seitenweise
gelesenen NDJSON-Datei je freigegebener Tabelle. Das Manifest enthält den Dateipfad und die vor sowie
nach dem Export geprüfte Zeilenzahl jeder Tabelle. Der Archivstrom wird während der Erzeugung
inkrementell mit SHA-256 gehasht und über R2 Multipart Upload übertragen. Die fertige Prüfsumme liegt
in einem separaten `.sha256`-Objekt, auf das die R2-Metadaten des Archivs verweisen; ein Archiv ohne
passendes Sidecar gilt nicht als wiederherstellbar.

Der Restore-Leser akzeptiert während der Übergangsfrist sowohl das bisherige JSON-Format 1 als auch
das ZIP-/NDJSON-Format 2. Der Format-1-Pfad darf frühestens entfallen, wenn keine Format-1-Sicherung
mehr innerhalb der Aufbewahrungsfrist liegt und zwei aufeinanderfolgende monatliche Restore-Proben
mit Format 2 erfolgreich waren.

## Konsequenz

Ein Cron-Handler allein gilt nicht als erfülltes Backup. Export, Lifecycle, Restore und Nachweis müssen
implementiert und getestet werden.

Die neue Struktur begrenzt den Worker-Speicher auf eine Tabellenseite, ZIP-Ausgabepuffer und ein
R2-Multipart-Teil. Ein fehlgeschlagener Multipart Upload wird abgebrochen. Schlägt erst das Schreiben
des Prüfsummen-Sidecars fehl, bleibt das Archiv bewusst als nicht restorefähiges, später von der
Aufbewahrung bereinigtes Objekt liegen; es wird niemals ohne Prüfsumme freigegeben.

## Nachweis

Der Cron erzeugt täglich einen portablen Export und kennzeichnet den Lauf automatisch als
`PRE_EVENT`, wenn am folgenden Berliner Kalendertag eine Veranstaltung ansteht. R2-Objekte bleiben
mindestens 14 vollständige Tage erhalten. `npm run backup:restore:test` führt den vollständigen
Schema-, Export- und Restore-Rundlauf für Format 1 und 2 mit synthetischen Daten isoliert aus und ist
Teil des Projektchecks. Ein zusätzlicher Skalennachweis erzeugt große synthetische Audit-, Prognose-
und Outbox-Bestände, prüft 500-Zeilen-Seiten, inkrementelle SHA-256-Bildung und mehrere
5-MiB-Multipart-Teile. Das Betriebshandbuch beschreibt die Umschaltung innerhalb des
30-Minuten-Ziels.
