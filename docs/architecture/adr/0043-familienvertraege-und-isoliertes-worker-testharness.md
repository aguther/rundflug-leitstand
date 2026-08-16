# ADR-0043: Familienverträge und isoliertes Worker-Testharness

- Status: Akzeptiert
- Datum: 2026-08-12
- Entscheidung: Auftraggeber im Rahmen von AP-15
- Betroffene Anforderungen: Q-WAR-010, Q-WAR-040

## Kontext

Der öffentliche Operations-Vertrag bündelte Command-Schemas, Board-Projektionen und Hilfsverträge in
einem Modul mit mehr als 1.200 Zeilen. Interne Domain-Module importierten einzelne Kernsymbole aus dem
eigenen öffentlichen Barrel. Zugleich wiederholten lokale Integrationsverifier Migration, Seed,
Worker-Start, Portwahl und Prozessbereinigung; neun Verifier verwendeten einen festen Port und einen
gemeinsamen lokalen D1-Zustand. Dadurch hatten kleine Änderungen breite Änderungsflächen und mehrere
Verifier konnten nicht sicher parallel laufen.

## Entscheidung

- `@rundflug/contracts/operations-dispatch` bleibt als kompatible Fassade erhalten. Command-Schemas
  werden intern und über öffentliche Subpaths den Familien Administration, Flight, Planning und
  Ticketing zugeordnet. Board- und Assistance-Verträge besitzen eigene Module.
- Ein Exhaustiveness-Test belegt, dass alle 57 Schemaoptionen und 59 eindeutigen
  Command-Discriminatoren genau einmal in der Fassade enthalten sind. Root- und bisheriger Subpath
  exportieren weiterhin dieselben bestehenden Symbole.
- Domain-Module importieren interne Kernsymbole direkt aus dem besitzenden Modul. `index.ts` bleibt
  ausschließlich die kompatible öffentliche Fassade und darf nicht als interner Rückimport dienen.
- Lokale Worker-Integrationsverifier verwenden ein gemeinsames Harness. Jede Instanz reserviert einen
  freien Loopback-Port und erhält ein eigenes temporäres D1-Persistenz- und Assets-Verzeichnis. Das
  Harness führt Migrationen, synthetische Seeds, optionale Vorbereitungskommandos, Startprüfung und
  Prozessbereinigung aus.
- Verifier dürfen parallel laufen, ohne `.wrangler/state`, einen festen Port oder gebaute Web-Assets
  zu teilen. Spezialisierte Langzeit- und Performance-Harnesses dürfen eigene Ressourcensteuerung
  behalten, müssen ihre Zustände ebenfalls explizit isolieren.
- Die semantisch identischen Aktiv-, Oberflächen- und Control-Regeln der Administration sowie von
  Flight Director und Flight-Line-Assist werden in gemeinsamen Selektorgruppen konsolidiert. Die
  vorhandenen Designsystem-Tokens, Selektorspezifitäten und sichtbaren Zustände bleiben unverändert.

## Folgen

Neue Commands werden in genau einer fachlichen Vertragsfamilie ergänzt und durch den gemeinsamen
Envelope weiter kompatibel bereitgestellt. Änderungen an Board-Projektionen ziehen keine Bearbeitung
der Command-Familien nach sich. Interne Domain-Abhängigkeiten bleiben sichtbar und zyklenarm.

Lokale Integrationsläufe benötigen kein vorheriges Web-Build und können sicher parallelisiert werden.
Das Harness selbst bleibt ein Testwerkzeug ohne Produktionsabhängigkeit; temporäre Zustände und
Worker-Prozesse werden auch bei Fehlern beseitigt. Die fachlichen Assertions der migrierten Verifier
bleiben unverändert.

Die konsolidierten CSS-Regeln reduzieren mehrfache Pflege derselben semantischen Zustände, ohne neue
globale Utility-Klassen oder eine zusätzliche Stylesheet-Abhängigkeit einzuführen. Light- und
Dark-Mode verwenden weiterhin ausschließlich die bestehenden `--ui-*`-Tokens.
