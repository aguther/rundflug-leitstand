# Architektur

Die primäre Architekturdokumentation des Rundflug-Leitstands folgt arc42 und liegt unter
[`arc42/`](arc42/README.md). Sie beschreibt den aktuell implementierten Stand.

Ergänzende Artefakte:

- [`adr/`](adr/) – Architecture Decision Records mit Entscheidungshistorie;
- [`technical-debts/`](technical-debts/README.md) – ausschließlich aktuell bestätigte technische
  Schulden, nach Themen getrennt;
- [`concepts/`](concepts/README.md) – unverbindliche Zukunftskonzepte, die den aktuellen
  Architekturstand nicht ändern.

Das generierte arc42-PDF ist ein lokales Ausgabeformat und wird nicht versioniert. Es kann bei
Bedarf mit `npm run docs:arc42:pdf` unter `output/pdf/` erzeugt werden.
