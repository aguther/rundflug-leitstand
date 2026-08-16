# ADR-0034: Support-sichere Analyseexporte und deterministischer Replay

- Status: Akzeptiert – Hybridmodell durch Auftraggeber am 2026-08-02 freigegeben
- Datum: 2026-08-02
- Betroffene Anforderungen: V1120-DIA-010, V1120-DIA-020, V1120-DIA-030,
  V1120-EXP-010, V1120-RPL-010, V1120-AUD-010, V1120-SEC-010, V1120-OPS-010,
  V1120-PER-010 und V1120-QA-010
- Fortgeltende Grundlagen: F-PRG-010 bis F-PRG-130, F-HIS-020 bis F-HIS-070,
  Q-ZUV-020, Q-ZUV-040, Q-PER-020, Q-PER-030, Q-SIC-020, Q-DSG-010 bis
  Q-DSG-040, T-050 und T-100

## Kontext

Der Worker persistiert heute Forecast-Projektionen und Dispatch-Diagnostik an `rotations` und
`forecast_snapshots`. Das reicht zur Darstellung, aber nicht zur sicheren Trennung zwischen einem
fehlerhaften relationalen Eingangszustand, der Worker-Aufbereitung, dem reinen Domainergebnis, der
Persistenz und dem lokalen UI-Zustand. Tagesberichte und Rohdatenexporte beantworten andere
Auswertungszwecke; sie dürfen nicht als ungeprüfte Diagnosepakete erweitert werden.

Ein generischer Tabellendump wäre besonders riskant. Das D1-Schema enthält unter anderem Hashes
öffentlicher Codes, geschützte Klarwerte für Nachdrucke, Sitzungs- und Gerätebezüge, Push-Ziele,
optionale Freitexte und Einzelgewichte. Auch das append-only Ereignisledger darf wegen seiner
typspezifischen Payloads nicht ungeprüft durchgereicht werden.

ADR-0002 verlangt D1 als relationale Source of Truth und Veröffentlichung erst nach Persistenz.
ADR-0003 verlangt EU-Jurisdiktion für D1, Durable Objects und R2. ADR-0032 und ADR-0033 definieren
einen deterministischen gemeinsamen Dispatch-/Forecast-Kern, ändern aber bewusst nicht dessen
vollständige Eingabe- und Ausgabearchivierung. Diese ADR ergänzt Diagnose und Replay, ohne die
Planungsregeln oder die menschliche Entscheidungshoheit zu verändern.

## Entscheidung

### 1. Zwei aufeinander aufbauende Exportstufen

Stufe 1 ist eine während des Betriebs erzeugte JSON-Momentaufnahme. Sie verbindet einen
konsistenten support-sicheren Betriebszustand, den exakt passenden jüngsten Planungslauf, dessen
Forecast-Snapshots und einen optionalen sicheren lokalen UI-Kontext.

Stufe 2 ist ein serverseitig erzeugtes ZIP-Tagesanalysepaket für `CLOSED` oder `ARCHIVED`. Es wird
asynchron erstellt, in R2 archiviert und enthält alle support-sicheren Planungsläufe,
Forecast-Snapshots, Zustandsprojektionen, Ereignisprojektionen sowie JSON-/NDJSON-/CSV-/Markdown-
Auswertungen, die für eine Tagesanalyse und einen Offline-Replay erforderlich sind.

Ein laufender Tag wird nicht als langfristiges Tagespaket eingefroren. Dafür bleibt die
Momentaufnahme maßgeblich. Wird ein geschlossener Tag administrativ wieder geöffnet und später mit
einer neuen Veranstaltungsversion erneut geschlossen, entsteht ein neues Archiv; vorhandene
Archive werden nicht überschrieben.

### 2. Ausschließlich Datenschutzprofil `SUPPORT_SAFE`

Beide Stufen verwenden genau ein strikt versioniertes Profil `SUPPORT_SAFE`. Alle Serverinhalte
entstehen aus typisierten Allowlist-Projektionen. Zulässig sind technische interne IDs,
Kommunikationsnummern, Gruppenbeziehungen, Queue-Reihenfolge, Zeitstempel, operative Codes und
Flugzeugkennzeichen, soweit sie für Analyse und Replay erforderlich sind.

Ausgeschlossen sind insbesondere:

- öffentliche Ticket- und Gruppencodes einschließlich Hashes,
- PIN-, Sitzungs-, Geräte- und Setup-Credentials,
- Push-Endpunkte, Browser-Schlüssel und Zustellcredentials,
- Konto-IDs, Login-Codes und Sitzungsobjekte,
- Einzelgewichte, Zahlungsdetails und vollständige User-Agent-Strings,
- freie Notizen, Gründe oder Ereignis-Payloads ohne ereignisspezifische Projektion,
- IP-, Request- und sonstige Infrastrukturmetadaten.

Falls die bloße Existenz eines Freitexts diagnostisch relevant ist, darf nur eine Metainformation
aus `present`, `length` und einem paketbezogenen SHA-256-Hash ausgegeben werden. Ein unbekannter
Ereignistyp exportiert ausschließlich sichere technische Metadaten und
`redactedUnknownPayload: true`. Ein späteres Profil `INTERNAL_FULL` benötigt neue Requirements,
eine neue Datenschutzfreigabe und eine eigene Architekturentscheidung.

### 3. Hybride Planungsläufe in D1

Jede erfolgreiche relevante Forecast-Neuberechnung erzeugt einen kleinen unveränderlichen
`planning_run`. Ein Lauf referenziert einen wiederverwendbaren `planning_context`, seinen
Vorgängerlauf, `calculation_now`, Trigger, Capture-Modus, Source-Revision, Dispatch-Revision,
Ergebnisdigests und Laufzeit. Die Capture-Modi sind `REFERENCE`, `CHANGE` und `ANCHOR`.

Ein unveränderter 30-Sekunden-Tick mit derselben Veranstaltungsversion verwendet den bestehenden
Kontext ohne erneute Chunk-Serialisierung oder Hashbildung. Vollständige Anker entstehen bei jedem
fachlichen Nicht-Timer-Ereignis, spätestens fünf Minuten nach dem letzten Anker, bei geänderter
Dispatch-Revision oder Voraufrufentscheidung, bei qualitativen Forecaständerungen, bei manueller
Diagnose, Berechnungsfehler oder geänderter Source-Revision. Unbekannte neue Trigger ankern
vorsichtshalber. Zwischen zwei Ankern liegen höchstens zehn Referenzläufe.

Planungseingaben werden nicht als monolithisches JSON gespeichert. `planning_chunks` trennt
Eventkonfiguration, Rotationen und Queue, Kapazitäten, Dauerstichproben, operative Einschränkungen
und vorherigen Dispatch-Zustand. Große Mengen werden deterministisch nach Art, Ressourcengruppe und
stabilem ID-Bucket mit höchstens 50 Einträgen partitioniert. `planning_contexts` speichert nur ein
kleines Manifest der Chunk-IDs. Gleiche Chunks werden je Veranstaltung, Art, Schemaversion und
SHA-256-Hash wiederverwendet.

`calculation_now` und abgeleitete Prognosewerte erscheinen in keinem Eingangschunk. Der Zeitpunkt
steht ausschließlich am Lauf; abgeleiteter Vorzustand wird über `previous_run_id` beziehungsweise
einen Ankerzustand aufgelöst. Dispatch- und Voraufrufergebnisse werden bei Änderung oder Anker
vollständig gespeichert, Referenzläufe enthalten Revision beziehungsweise Digest. Die vorhandenen
30-Sekunden-`forecast_snapshots` bleiben unverändert häufig, referenzieren den Lauf und bilden die
vollständige numerische Forecast-Ausgabe.

Neue Chunks und Kontexte dürfen vorab idempotent angelegt werden. Der erfolgreiche Lauf,
Rotation-Projektionen und Forecast-Snapshots werden anschließend in derselben fachlich konsistenten
D1-Batch-/Transaktionsgrenze gespeichert. Ein Lauf darf niemals als erfolgreich erscheinen, wenn
die Projektion unvollständig ist. Fehlerdaten enthalten nur normierte technische Codes.

Die bestehende Domainfunktion bleibt als kompatibler Projektionen-Wrapper erhalten. Eine neue reine
Ergebnisfunktion trennt Basiszustand, vorherigen Forecastzustand und `calculationNow` und liefert
Projektionen sowie Dispatch- und Voraufrufdiagnostik. Produktion und Simulator verwenden dieselbe
Ergebnisfunktion; es gibt keine zweite Diagnoseberechnung.

### 4. Konsistenzmodell der Momentaufnahme

`GET /api/control/:eventId/analysis/snapshot.json` ist ausschließlich für `ADMIN` und
`FLIGHT_DIRECTOR` freigegeben und verlangt `expectedEventVersion`. Der Worker:

1. prüft Rolle und erwartete Veranstaltungsversion,
2. lädt die gemeinsame `OperationBoard`-Projektion und den jüngsten passenden Planungslauf,
3. verlangt dieselbe Veranstaltungsversion und Dispatch-Revision für Board, Lauf und Snapshots,
4. liest die Veranstaltungsversion danach erneut,
5. wiederholt bei Änderung höchstens zweimal und bricht anschließend eindeutig ab.

Ein veralteter, unvollständiger oder während des Exports geänderter Stand wird mit einem sicheren
Konfliktcode abgewiesen. Der Export bezeichnet nie einen älteren Planungslauf als aktuell. Die
heute im Routenhandler eingebaute OperationBoard-Erzeugung wird dafür in eine gemeinsame
Projektion extrahiert; Diagnose und reguläre Operationsroute duplizieren weder SQL noch Mapping.

Die Serverantwort ist ein strikt validiertes JSON mit `no-store`. Der Browser validiert sie,
ergänzt optional einen ebenfalls strikt validierten Clientkontext und validiert das Gesamtobjekt
vor dem lokalen Blob-Download erneut.

Der Clientkontext lebt ausschließlich in einem flüchtigen Ringpuffer mit höchstens 100
allowlist-basierten Ereignissen. Er darf Route, ausgewählte technische IDs, lokalen
Gruppenauswahlstand, sichtbare Dispatch-Empfehlung, Dialogstatus, Verbindungsstatus, Viewport,
PWA-Modus sowie Browserfamilie und Hauptversion enthalten. Cookies, Web-Storage-Dumps,
Sitzungsdaten, Konto-/Gerätekennungen, freie Eingaben, Abweichungsgründe, vollständiger User Agent,
Netzwerkdaten und Fehlerstacks sind verboten.

### 5. Unveränderliche Tagesarchive und getrenntes Zugriffsprotokoll

`analysis_archives` führt den asynchronen Zustand `PENDING`, `BUILDING`, `READY`, `FAILED`,
`EXPIRED` oder `DELETED`. Die Kombination aus Veranstaltung, Quellversion, Formatversion und
Datenschutzprofil ist eindeutig. `request_id` und `request_hash` sichern manuelle Wiederholungen;
ein konditionales Update mit erwarteter Archivversion erlaubt höchstens einen Builder.

Der erfolgreiche Übergang nach `CLOSED` legt den Archivjob in derselben fachlich konsistenten
Persistenzgrenze an. Die operative Schließung wartet nicht auf die Dateierzeugung; der erste
Buildversuch startet erst nach Persistenz über nachlaufende Arbeit. `READY` ist erst zulässig,
nachdem R2 die vollständige Datei bestätigt und D1 Objektschlüssel, ETag, Größe und Zählwerte
gespeichert hat.

`analysis_archive_events` ist ein eigenes append-only Zugriffsprotokoll für Anforderung,
Buildbeginn, Fertigstellung, Fehler, Download, Ablauf und Löschung. Es enthält Rollen und bei Bedarf
einen stabilen archivebezogenen Alias, aber keine Klartext-Konto-ID. Diese Ereignisse verändern
nicht `operation_days.version`, lösen keine Forecast-Neuberechnung aus und erzeugen weder operative
Outbox- noch öffentliche Realtime-Nachrichten.

### 6. R2-Präfix, Streaming und Integrität

Die vorhandene private EU-R2-Bindung wird unter
`analysis/<event-id>/<event-date>/<archive-id>.zip` wiederverwendet. Es gibt keine öffentliche
Bucket-URL und keinen dauerhaft signierten Link; Downloads werden nach erneuter Rollen- und
Statusprüfung aus dem R2-Body gestreamt. R2-Custom-Metadata bleibt auf nicht geheime
Format-, Versions-, Event-, Profil- und Erstellinformationen begrenzt.

Die ZIP-Implementierung beginnt erst nach einem dokumentierten Worker-Spike. Der Spike prüft
vorzugsweise `fflate`, Lizenz und Dependency-Allowlist, Worker-Dry-Run, inkrementelle ZIP-Ausgabe,
Backpressure, Abbruch und R2-Multipart-Upload. D1 wird seitenweise und sequenziell gelesen; NDJSON
und CSV werden inkrementell geschrieben. ZIP, Tageslisten und vollständige R2-Datei dürfen nicht
als ein zusammenhängender `Uint8Array` gepuffert werden. Multipart-Teile bleiben begrenzt, werden
in gültiger einheitlicher Größe hochgeladen und bei Fehlern abgebrochen.

Cloudflare dokumentiert für Workers Web Streams zur Vermeidung vollständiger Speicherpufferung und
stellt in der R2-Workers-API `createMultipartUpload`, `uploadPart`, `complete` und `abort` bereit:

- <https://developers.cloudflare.com/workers/runtime-apis/streams/>
- <https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/>
- <https://developers.cloudflare.com/r2/reference/consistency/>

Schlägt der Spike fehl, stoppt WP3. Es wird weder synchron gepuffert noch eigenmächtig eine zweite
Bibliothek eingeführt; ADR und Containerentscheidung müssen dann erneut freigegeben werden.

Manifest, Pflichtdateien, ZIP-CRC und die SHA-256-Hashes kanonischer Planungschunks bilden den
verbindlichen Offline-Integritätsnachweis. Ein Hash über das gesamte ZIP wird nur ergänzt, wenn der
Spike eine inkrementelle Berechnung ohne Ganzarchivpufferung belegt. Ein R2-ETag wird als externe
Objektmetadateninformation behandelt und nicht als allgemeiner kryptografischer Dateihash
ausgegeben.

### 7. Aufbewahrung und Löschung

`ANALYSIS_RETENTION_DAYS` ist von der Backup-Frist unabhängig und akzeptiert ausschließlich
`14..365`. Entwicklung und Abnahme verwenden zunächst 30 Tage. Produktion muss vor Freigabe einen
ausdrücklich bestätigten Wert besitzen; OQ-18 hält diese Betreiberentscheidung offen.

Der tägliche Wartungslauf löscht abgelaufene R2-Objekte paginiert und sequenziell, setzt den
D1-Status auf `EXPIRED` und ergänzt das append-only Analyseereignis. Manuelle Löschung setzt
`DELETED`; Metadaten und Zugriffshistorie bleiben erhalten. Veranstaltungslöschung entfernt alle
Objekte unter dem eventbezogenen Analysepräfix vor den D1-Zeilen in gültiger
Fremdschlüsselreihenfolge. Der Werksreset berücksichtigt Analyseobjekte und neue Tabellen.

Planungschunks, Planungskontexte, Planungsläufe, Archivmetadaten und Analyseereignisse werden in den portablen
D1-Backupregister aufgenommen. Die großen R2-Tagesdateien werden nicht in das portable D1-JSON
eingebettet. Eine R2-Lifecycle-Regel darf höchstens als länger laufendes betriebliches Sicherheitsnetz
dienen; die auditierte Anwendungslöschung bleibt führend, weil ein verzögerter Provider-Lifecycle
keinen korrekten D1-Statusübergang erzeugt.

### 8. Source-Revision und Offline-Replay

`SOURCE_REVISION` ist nicht geheim. CI setzt den Git-Commit, lokale Läufe verwenden `local` oder
`unknown`. `/api/meta`, Planungsläufe, Momentaufnahmen und Tagesmanifest geben ihn neben Anwendung,
Requirements- und Schemaformatversion aus. Eine Produktionsverifikation verlangt vor der
Produktionsfreigabe einen konkreten Wert.

Das lokale Replay-Werkzeug schreibt niemals in D1 oder R2. Es prüft Format, Pflichtdateien,
Referenzen und Hashes und rekonstruiert Dispatch, Forecast und Voraufruf mit `calculation_now` aus
dem Lauf. Standardmäßig muss `manifest.sourceRevision` zum ausgecheckten Stand passen. Eine
ausdrückliche Option darf trotz Versionsabweichung vergleichen, kennzeichnet Abweichungen dann aber
als versionsbedingt und behauptet keine bitidentische Reproduktion.

### 9. UI-Grenzen

Administration erweitert den bestehenden Bereich **Auswertung** um die freizugebende Ansicht
**Analyse und Diagnose**. Flight Director erhält eine sekundäre Diagnoseaktion außerhalb der
Flugzeugzeilen. Positionen, stabile Zustände, Belegungsdialogverhalten, Tastaturführung sowie
Desktop-/Tablet-/Light-/Dark-Abnahme sind in
[`analysis-export-concept.md`](../../ui/analysis-export-concept.md) festgelegt.

Die Analyseoberfläche ist keine generische Kartenlandschaft und verändert weder Kassen- noch
Flight-Line-Primärabläufe. Der Export trifft keine flugbetriebliche, sicherheitsrelevante,
dienstzeitrechtliche oder luftrechtliche Aussage.

## Fehlerverhalten

- Ein fehlender oder nicht passender Planungslauf verhindert die Momentaufnahme mit
  `ANALYSIS_SNAPSHOT_NOT_READY` beziehungsweise `ANALYSIS_SNAPSHOT_DATA_INCOMPLETE`.
- Eine während der Momentaufnahme geänderte Veranstaltung wird niemals still gemischt.
- Ein Archivfehler setzt `FAILED` mit normiertem Fehlercode; Retry verwendet denselben logischen
  Archivdatensatz und erzeugt kein zweites Archiv derselben Quellversion.
- Ein abgebrochener Multipart-Upload wird bestmöglich abgebrochen und niemals als `READY`
  veröffentlicht.
- Ein fehlendes oder gelöschtes R2-Objekt bei vermeintlichem `READY` wird als Integritätsfehler
  behandelt, nicht als leerer Download.
- Unbekannte Contract- oder Dateiformatversionen werden kontrolliert abgewiesen.

## Ausdrücklich ausgeschlossen

- Änderungen an Dispatch-Zielordnung, Forecast, Fairness, Überholungsgrenzen oder Voraufruf,
- rohe Tabellen- oder Ereignis-Payload-Dumps,
- Profil `INTERNAL_FULL`,
- Restore, Import oder Produktions-Replay,
- öffentliche oder dauerhaft signierte R2-Downloads,
- Namen, Telefonnummern, Lizenzdaten oder neue Gastdaten,
- Ganzarchivpufferung im Worker oder Browser.

## Folgen und Umsetzungsreihenfolge

Die hybride Planungserfassung muss im 12-Stunden-/300-Umlauf-Fall einschließlich Indizes höchstens
50 MB zusätzliche D1-Daten erzeugen. Ihre zusätzliche CPU-Zeit darf im p95 weder 50 ms noch zehn
Prozent des Forecast-Laufs überschreiten. Unveränderte Timer-Ticks müssen den Kontext vollständig
wiederverwenden. Eine Budgetüberschreitung stoppt WP1 vor Merge; Grenzwerte werden nicht
nachträglich aufgeweicht. Stufe 2 darf die operative Schließung nicht verlängern und benötigt
getrennte Laufzeit-, Speicher-, D1- und R2-Nachweise.

Die Umsetzung erfolgt sequenziell in WP1 bis WP4. OQ-17 und OQ-19 wurden am 2026-08-02 durch den
Auftraggeber freigegeben; die ADR ist damit akzeptiert. Produktionsgates einschließlich OQ-18
bleiben bestehen.

## Verworfene Alternativen

- **Nur vorhandene Rotation-/Snapshot-Felder exportieren:** trennt Worker-Aufbereitung und
  Domainberechnung nicht und ermöglicht keinen vollständigen Replay.
- **Fünf monolithische Payloads je Forecast-Lauf:** dupliziert bei kleinen Änderungen große
  Kontexte und verbraucht trotz Inhaltsadressierung unnötig CPU und D1-Speicher.
- **Reduzierte Forecast-Snapshot-Frequenz:** schwächt die vorhandene zeitliche Analyse und ist für
  die Optimierung des zusätzlichen Diagnosebedarfs nicht erforderlich.
- **Rohe D1-Tabellen exportieren:** verletzt Datenminimierung und koppelt das Format unkontrolliert
  an interne Schemaänderungen.
- **ZIP bereits in Stufe 1:** fügt unnötige Abhängigkeit und Speicherkomplexität hinzu.
- **Tagesarchive während des Betriebs:** erzeugt eine veränderliche Langzeitkopie ohne stabilen
  fachlichen Abschlussstand.
- **Archivzugriffe im operativen Eventledger:** würden Veranstaltungsversion, Forecast und
  Realtime unnötig beeinflussen.
- **Vollständiges ZIP im Speicher:** verletzt das V1-Performance- und Worker-Speicherbudget.

## Freigabe- und Nachweisgates

Vor WP1 erfüllt:

- OQ-17 und OQ-19 am 2026-08-02 freigegeben,
- dieses Dokument auf `Akzeptiert` gesetzt,
- UI-Konzept ausdrücklich freigegeben.

Vor WP3 zusätzlich:

- Worker-/Dependency-/Lizenzspike erfolgreich,
- konkrete Performancebudgets aus Q-PER-020 und Q-PER-030 dokumentiert,
- R2-Multipart-Abbruch und Worker-Dry-Run nachgewiesen.

Vor Produktion zusätzlich:

- OQ-18 und konkretes `ANALYSIS_RETENTION_DAYS` freigeben,
- `SOURCE_REVISION` belegt,
- EU-, Datenschutz- und R2-Lifecycle-Nachweis aktualisiert,
- Secret-/Token-Canaries, Restore-/Reset- und vollständiger Replay erfolgreich.
