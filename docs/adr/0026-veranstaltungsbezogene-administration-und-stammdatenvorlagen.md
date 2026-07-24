# ADR-0026: Veranstaltungsbezogene Administration und portable Stammdatenvorlagen

- Status: Akzeptiert
- Datum: 2026-07-24
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: F-ADM-060, F-ADM-080, Q-UX-020 und F-SLT-040

## Kontext

Die bisherige Administration verteilte Veranstaltungsparameter, Stammdaten, Betrieb und Audit auf
mehrere Hauptbereiche. Gleichzeitig duplizierte sie operative Flotten- und Ressourcensteuerung, die
fachlich beim Flight Director liegt. Die Kopie einer Vorveranstaltung ist für den direkten Neustart
geeignet, aber kein portables, vor einem Import prüfbares Austauschformat für wiederverwendbare
Stammdaten.

Die neue Oberfläche darf keine Gastnamen speichern, keine operative Automatik einführen und die
dokumentierte Korrekturschranke nach Flugbeginn aus F-SLT-040 nicht aufweichen.

## Entscheidung

- Die Administration verwendet fünf Hauptbereiche. Alle veranstaltungsbezogenen Parameter,
  Stammdaten, Betriebsfunktionen und Abschlussnachweise liegen als acht Schritte unter
  **Veranstaltungen**.
- Eine explizit gewählte Veranstaltung ist der Datenkontext. Diagramm und administrative
  Auswertungen mischen keine Veranstaltungen.
- Operative Hinweise, Ressourcengruppenstatus und Pilotenpausen werden im Flight-Director-Dialog
  gesteuert. Flugzeugstatus und Tankplanung verbleiben in den Flight-Line-Zeilen. Administration
  behält Lebenszyklus, Verkaufssteuerung, Not-Halt-Aufhebung und die dokumentierte
  Besetzungskorrektur.
- `SET_OPERATIONAL_NOTE` ist für `FLIGHT_DIRECTOR` und `ADMIN` zulässig. Erwartete Version,
  Idempotenzbeleg, Audit und Outbox bleiben zwingend. `CLEAR_EMERGENCY` bleibt Admin-only.
- `AdminEventFlow` aggregiert ausschließlich relationale Ticket-, Zuordnungs- und Umlaufdaten der
  gewählten Veranstaltung. Gültige, nicht stornierte Tickets zählen ab Verkauf; abgeschlossen sind
  sie erst mit dem Abschluss des aktuell zugeordneten Umlaufs.
- Das portable JSON-Format heißt `rundflug-master-data-template` und besitzt die Formatversion 1.
  Es verwendet nur vorlagenlokale Schlüssel und enthält Parameter, Gates, Ressourcengruppen,
  Flugzeuge, Zuordnungen, Pilotencodes und Produkte.
- Konten, Sitzungen, Geräte, Tickets, Buchungs- und Fluggruppen, Umläufe, Audit, Idempotenz, Outbox,
  Not-Halt, Unterbrechungen, Hinweise, Pilotenpausen und aktuelle Pilotbindungen sind ausgeschlossen.
- Der Import ist nur in eine leere Veranstaltung in `PREPARATION` zulässig. Es gibt kein Merge und
  kein Ersetzen. Client und Worker validieren Format, Größe, Referenzen und Dubletten.
- Der Worker erzeugt neue veranstaltungsbezogene IDs und verwendet ein vorhandenes Flugzeug nur bei
  exakt kompatibler Kennung und Konfiguration wieder. Ein transaktionaler Idempotenz-Guard schützt
  alle Einfügungen; genau ein Event-Versionssprung, ein Audit-Eintrag und ein Outbox-Eintrag werden
  gemeinsam bestätigt.
- Die Änderung benötigt keine D1-Schemamigration und keine neue Frontend-Abhängigkeit.

## Folgen und Wiederherstellung

Bestehende Links werden auf den passenden Veranstaltungsschritt abgebildet. Alte Clients können die
additiven Endpunkte ignorieren. Ein falscher Import wird nicht überschrieben oder rückgängig
gemacht; die noch leere Vorbereitungsveranstaltung wird gelöscht und neu erstellt.

Ein Rollback erfolgt durch Bereitstellung der vorherigen Worker- und Web-Version. Bereits
importierte Stammdaten bleiben normale relationale Stammdaten und sind vollständig lesbar. Das
portable Exportformat bleibt als Datei erhalten, erzeugt ohne die neuen Endpunkte jedoch keine
Mutation.
