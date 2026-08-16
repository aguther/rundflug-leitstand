# ADR-0050: Wiederaufnehmbarer D1-Werksreset in begrenzten Transaktionen

## Status

Angenommen – Release 1.12.0

## Kontext

Der vollständige Werksreset löschte bisher alle Anwendungstabellen in einem einzigen D1-Batch.
Eine gewachsene Abnahmeinstallation mit mehreren zehntausend indizierten Planläufen und
Prognose-Snapshots überschritt damit die praktisch verfügbare Ausführungsdauer des D1-Aufrufs. Der
Worker antwortete nach rund 36 Sekunden mit HTTP 500; D1 rollte den gesamten Batch zurück.

Der Reset ist ausdrücklich destruktiv und darf Nutzdaten vollständig verwerfen. Gleichzeitig muss
ein technischer Abbruch wiederholbar bleiben: Insbesondere dürfen Administratorkonto, Sitzung und
Gerätebindung nicht bereits verschwunden sein, solange noch eine große Löschphase scheitern kann.

## Entscheidung

Der D1-Anteil wird in Kind-zu-Eltern-Reihenfolge ausgeführt:

1. Große Historienbereiche werden in eigenen D1-Phasen gelöscht. Die selbstreferenzierenden
   Planläufe werden entsprechend ihrer fachlichen Referenzrichtung in 2.000er-Chunks von den neuesten
   Versionen zu den früheren Ankerläufen geleert. Kleine, benachbarte Tabellen teilen sich begrenzte Löschphasen in
   Kind-zu-Eltern-Reihenfolge. Fremdschlüssel werden innerhalb jeder Transaktion aufgeschoben; die
   technische Reset-Freigabe für Append-only-Trigger wird in derselben Transaktion gesetzt und
   wieder entfernt.
2. Konten, Sitzungen, Gerätebindungen, Bootstrap- und Wurzeltabellen bleiben bis zum Schluss
   erhalten. Sie werden gemeinsam mit dem neuen idempotenten Reset-Beleg in einer kleinen finalen
   Transaktion gelöscht beziehungsweise geschrieben.
3. Scheitert eine Bulk-Phase, bleiben bereits abgeschlossene Löschphasen gelöscht. Der gleiche
   authentifizierte Administrator kann den Vorgang wiederholen; leere Tabellen machen die
   Wiederholung idempotent. Ein Beleg entsteht erst nach erfolgreicher finaler Transaktion.
4. Der Worker protokolliert bei einem D1-Fehler ausschließlich Fehlercode, technische Phase und
   Fehlertyp. PIN, Reset-Begründung, Sitzung, Tokens und Nutzdaten werden nicht geloggt.
5. Durable Objects werden weiterhin vor D1 geleert. Die optionale R2-Leerung bleibt der letzte,
   über den Reset-Beleg wiederaufnehmbare Schritt.

## Folgen

- Der gesamte D1-Reset ist nicht mehr eine einzige atomare Transaktion. Diese Einschränkung ist für
  den ausdrücklich angeforderten vollständigen Datenverlust vertretbar und verhindert den zuvor
  nicht ausführbaren Alles-oder-nichts-Batch.
- Ein Abbruch vor der finalen Transaktion kann einen teilweise geleerten Anwendungsbestand
  hinterlassen. Der Zustand ist nicht für den operativen Weiterbetrieb bestimmt; der dokumentierte
  Wiederherstellungsweg ist die Wiederholung des Werksresets.
- Die finalen Identitäts- und Wurzeldaten bleiben bei einem Bulk-Fehler erhalten. Scheitert die
  finale Transaktion, wird sie vollständig zurückgerollt und der Administrator kann ebenfalls
  wiederholen.
- Die Chunk-Löschung macht den destruktiven Reset linear skalierbar, ersetzt aber keine reguläre
  Aufbewahrungsstrategie. Die event- und tagesbezogene Verlagerung verifizierter Planungshistorie
  nach R2 mit anschließender D1-Kompaktierung bleibt als OQ-20 getrennt zu entscheiden.
- Der verpflichtende Integrationsnachweis erzeugt ungefähr 12.000 Planläufe und 8.000
  Prognose-Snapshots und prüft Reset, Setup-Fortsetzung und Idempotenz über die lokale
  Worker-/D1-Grenze innerhalb der dortigen Verbindungsgrenze. Der zusätzliche manuelle
  Produktionsmaßstab mit ungefähr 29.000 Planläufen und 24.000 Prognose-Snapshots wird über
  `npm run test:factory-reset:production-scale` ausgeführt.

## Wiederherstellung und Rückbau

Vor dem Reset bleibt die portable R2-Sicherung der bevorzugte Wiederherstellungspunkt. Nach einer
bereits begonnenen gestuften Löschung ist ein Code-Rückbau kein Daten-Rollback; der sichere
Forward-Repair besteht darin, den Werksreset mit derselben freigegebenen Zielsetzung erneut
auszuführen. Ein Restore wird weiterhin ausschließlich in eine isolierte Datenbank eingespielt und
geprüft.
