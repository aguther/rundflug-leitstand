# ADR-0012: Flugzeugzentrierte Abfertigung und adaptiver Voraufruf

- Status: Akzeptiert
- Datum: 2026-07-18
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: F-EVT-040, F-BRD-010, F-BRD-020, F-BRD-025, F-BRD-085,
  F-PRG-020, F-PRG-030, F-PRG-040, F-PRG-060, F-PRG-100, F-PRG-110, F-BEN-030,
  F-ADM-010, Q-UX-020

## Kontext

Die Bezeichnung `NEXT` beschreibt weder die konkrete Flugzeugbelegung noch den Beginn des Boardings
verständlich. Operativ beginnt die Arbeit der Flight Line außerdem mit einem zurückkehrenden oder
verfügbaren Flugzeug. Die bisherige harte Obergrenze für die Gate-Wartezeit kann den automatischen
Voraufruf vollständig verhindern. Eine ausschließlich ereignisgetriebene Neuberechnung reagiert
zudem nicht auf reinen Zeitablauf.

Veranstaltungen dauern üblicherweise einen Tag. Wetter, Flugshows und andere Unterbrechungen können
an einzelnen Tagen außergewöhnlich lange Umläufe erzeugen. Diese Verzögerungen müssen die aktuelle
Prognose verschieben, dürfen aber nicht als neue Normaldauer fortgeschrieben werden.

## Entscheidung

- Supervisor und Assist arbeiten primär je Flugzeug. Ein verfügbares Flugzeug öffnet seine passende,
  nach Queue-Reihenfolge sortierte Auswahl ganzer Buchungsgruppen.
- Die Flight Line bestätigt Flugzeug, Pilotencode und vollständige Belegung mit der sichtbaren Aktion
  „Belegung bestätigen & Boarding starten“. `CALL_NEXT` darf als interner, kompatibler Kommandoname
  bestehen bleiben, erscheint aber nicht mehr als fachliches Bedienwort.
- Eine nicht anwesende vorderste Gruppe wird niemals still übersprungen. Zurückstellung, No-Show,
  unvollständige Mitnahme oder Leerplatz bleiben ausdrückliche, auditierte Entscheidungen.
- `GO TO GATE` bleibt vom verbindlichen Boarding getrennt und wird ausschließlich systemseitig
  ausgelöst. Der Event-Durable-Object prüft die Lage regelmäßig und zusätzlich nach relevanten
  Ereignissen.
- Jeder Prognoselauf verarbeitet je Ressourcengruppe ein zusammenhängendes Queue-Präfix auf Basis
  desselben frischen Prognose- und Ressourcen-Snapshots. Bereits voraufgerufene Gruppen behalten ihre
  Position und lassen die Prüfung weiterlaufen; der erste noch nicht voraufgerufene ungeeignete
  Kandidat sperrt alle späteren Gruppen dieser Ressource für diesen Lauf.
- Alle innerhalb dieses Präfixes berechtigten Gruppen werden im selben Prognoselauf gemeinsam
  voraufgerufen. Das gilt auch für mehrere Gruppen desselben Gates. Der Gate-Abstand wird aus dem vor
  Beginn des Laufs gespeicherten Stand ermittelt und erst für einen späteren Prognoselauf erneut
  bewertet.
- Die Gate-Wartezeit ist ein weiches Optimierungsziel. Eine harte maximale Wartezeit und eine harte
  Mindest-Prognosequalität blockieren keinen ansonsten sicheren Voraufruf.
- Der Zielvorlauf wird intern aus beobachteter Zeit zwischen Voraufruf und Boarding nachgeregelt und
  innerhalb konservativer Grenzen gehalten. In der Administration verbleibt nur die bewusste
  Aktivierung je Veranstaltung beziehungsweise Ressourcengruppe; technische Einzelschwellen werden
  nicht mehr als reguläre Bedienparameter angeboten.
- Messwerte des aktuellen Veranstaltungstags haben Vorrang. Vergleichswerte früherer Tage dienen nur
  als Kaltstart, bis bestätigte Tageswerte vorliegen.
- Umläufe, die eine bestätigte Betriebsunterbrechung oder einen Notfall überlappen, werden aus der
  Normal-Lernbasis ausgeschlossen. Zusätzlich begrenzt eine robuste, am Referenzwert verankerte
  Ausreißerbehandlung den Einfluss außergewöhnlicher Verzögerungen.

## Folgen

Der regelmäßige Voraufruf muss idempotent, versionsgeprüft und als Systemereignis auditiert bleiben.
Die ausgewählten Kandidaten werden in Queue-Reihenfolge gespeichert. Scheitert die
Erwartungsversion einer Gruppe, werden spätere Kandidaten derselben Ressourcengruppe in diesem Lauf
nicht geschrieben. Statusänderung, Audit-Ereignis und Outbox bleiben je Gruppe in einem
transaktionalen D1-Batch; Push-Aufträge entstehen nur für tatsächlich persistierte Voraufrufe.
Die konkrete Flugzeug- und Pilotenzuordnung entsteht weiterhin ausschließlich durch menschliche
Bestätigung. Bestehende Datenbankspalten für frühere Voraufrufschwellen bleiben vorerst lesbar, sind
aber fachlich veraltet und werden nach der Migration nicht mehr zur Auslöseentscheidung verwendet.
