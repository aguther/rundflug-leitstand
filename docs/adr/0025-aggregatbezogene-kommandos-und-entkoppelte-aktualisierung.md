# ADR-0025: Aggregatbezogene Kommandos und entkoppelte Aktualisierung

- Status: Akzeptiert
- Datum: 2026-07-24
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: F-INT-070, Q-ZUV-010, Q-ZUV-040, Q-PER-010, Q-PER-020 und
  Q-PER-030

## Kontext

Operative Kommandos wurden bisher ausschließlich gegen die globale Version des Veranstaltungstags
geprüft. Damit machte jede bestätigte Änderung alle gleichzeitig vorbereiteten Aktionen veraltet,
auch wenn sie ein anderes Flugzeug oder einen anderen Umlauf betrafen. Zusätzlich warteten
Bedienoberflächen nach der atomaren Persistenz noch auf Forecast-Neuberechnung, vollständige
Operationsprojektion und teilweise einen weiteren Druckdatenabruf. Diese Arbeiten sind fachlich
wichtig, gehören aber nicht zur Bestätigung der einzelnen Bedienaktion.

Das Durable Object je Veranstaltung bleibt die Instanz, die Kommandos ordnet. D1 ist weiterhin die
relationale Source of Truth; konkurrierende Schreibtransaktionen auf demselben Veranstaltungstag
werden nicht unkontrolliert parallel ausgeführt.

## Entscheidung

- Der bestehende globale `expectedVersion`-Vertrag bleibt für alle Kommandos kompatibel und
  unverändert streng.
- Die klar abgrenzbaren Flugzeug- und Umlaufkommandos dürfen zusätzlich genau eine
  `precondition` mit Aggregattyp, Aggregat-ID und erwarteter Aggregatversion sowie die beobachtete
  Veranstaltungsversion mitsenden.
- Das Durable Object reiht operative Kommandos explizit FIFO ein. Ein inzwischen fortgeschrittener
  globaler Veranstaltungsstand ist für ein solches Kommando zulässig, wenn die angegebene
  Aggregatversion noch aktuell ist. Ein veralteter Schreibversuch auf dasselbe Flugzeug oder
  denselben Umlauf wird weiterhin mit HTTP 409 abgelehnt und niemals still überschrieben.
- Forecast-Neuberechnungen werden nach erfolgreicher Persistenz über `waitUntil` angestoßen,
  150 Millisekunden entprellt und als Single-Flight ausgeführt. Während einer Berechnung neu
  eintreffende Auslöser erzeugen höchstens einen weiteren Lauf.
- WebSocket-, Polling- und Kommandoaktualisierungen verwenden pro Oberfläche einen
  Single-Flight-Koordinator. Gleichzeitige Anforderungen werden zusammengeführt; falls die erste
  Projektion die bestätigte Version noch nicht erreicht, folgt höchstens ein weiterer Abruf.
- Die UI übernimmt aus der Kommandobestätigung ausschließlich den bestätigten Event-Metadatensatz.
  Fachliche Flugzeug-, Umlauf- und Queuezustände bleiben serverseitige Projektionen und werden nicht
  optimistisch erfunden. Die betroffene lokale Busy-Anzeige bleibt bis zur sichtbaren Projektion
  dieser Bestätigung oder einer erklärenden Fehlermeldung aktiv; andere Aggregate bleiben
  bedienbar.
- Ein Verkauf liefert die geschützten Druckdaten bereits in seiner idempotenten
  Kommandobestätigung. Operationsabruf, QR-Erzeugung, Druckdialog und Listenaktualisierung laufen
  danach parallel. Die Verkaufs-Busy-Anzeige endet erst mit deren sichtbarem Erfolg oder einer
  erklärenden Fehlermeldung. Der öffentliche Gruppencode wird weder in Outbox noch Audit oder
  Anwendungslog aufgenommen.
- `Server-Timing` trennt Warteschlangen- und Kommandozeit; Browser-Performance-Einträge messen
  Operationsabrufe und operative Kommandos. Langsame Kommandos werden nur mit Dauer und stabilem
  Diagnosecode, ohne IDs, Codes oder personenbezogene Daten protokolliert.

Damit bedeutet Parallelisierung bewusst nicht, dass mehrere D1-Schreibvorgänge denselben
Veranstaltungsstand gleichzeitig verändern. Parallel werden Bedienung und unabhängige
Arbeitsvorbereitung; die bestätigten Mutationen bleiben geordnet, auditierbar und konfliktfest.

## Folgen und Wiederherstellung

Ältere Clients verwenden weiterhin ausschließlich `expectedVersion`. Neue Felder sind optional;
ältere gespeicherte Idempotenzbelege bleiben parsebar. Die Änderung benötigt keine
Datenbankmigration. Ein Rollback erfolgt durch Bereitstellung des vorherigen Workers und Web-Builds.
Dabei gehen keine Daten verloren; neue Clients fallen nach dem Rollback lediglich auf die globale
Konfliktprüfung und blockierende Nachaktualisierung zurück.
