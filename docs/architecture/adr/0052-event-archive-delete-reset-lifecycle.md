# ADR-0052: Koexistenz von Veranstaltungsarchiv, Löschung und Werksreset

- Status: Akzeptiert
- Datum: 2026-08-16
- Ersetzt: ADR-0016 hinsichtlich des Verzichts auf Archivierung
- Betroffene Anforderungen: F-ADM-080, D-100, V1120-EXP-010, V1120-OPS-010
- Ergänzt durch: ADR-0053 für ausgelagerte Planungshistoriensegmente

## Kontext

ADR-0016 priorisierte vor dem stabilen V1-Schema einen reset-first Testbetrieb und erklärte
dauerhafte Archive für entbehrlich. Der aktuelle Stand verwaltet mehrere Veranstaltungen, besitzt
einen expliziten `ARCHIVED`-Status, support-sichere Tagesanalysearchive und getrennte, abgesicherte
Lösch- und Werksresetpfade. Diese Mechanismen erfüllen unterschiedliche Zwecke und dürfen nicht als
Alternativen desselben Lebenszyklus behandelt werden.

## Entscheidung

- `ARCHIVED` ist der terminale fachliche Zustand einer erhaltenen Veranstaltung und bewahrt den
  relationalen Bestand für autorisierte Auswertung und Nachweis.
- Ein Tagesanalysepaket ist ein unveränderliches, support-sicheres R2-Artefakt und kein
  Produktionsimport oder Ersatz der D1-Source-of-Truth.
- Eine explizite Veranstaltungslöschung entfernt genau die bestätigte Veranstaltung und ihre
  abhängigen Artefakte nach den dokumentierten Sicherheits- und Wiederherstellungsregeln.
- Der Werksreset ist ein separat autorisierter, wiederaufnehmbarer Neuaufbau des gesamten
  Anwendungsbestands. Er ist kein normaler Archivierungs- oder Aufbewahrungsmechanismus.
- Wird die letzte Veranstaltung gelöscht oder der Werksreset abgeschlossen, kehrt die Anwendung in
  die Ersteinrichtung zurück.

## Konsequenzen

Archivieren, Löschen und Zurücksetzen besitzen getrennte Berechtigungen, Audit- und
Wiederherstellungspfade. Künftige Mandanten- oder Langzeitarchitektur darf diese Semantik erweitern,
aber nicht still vereinheitlichen.

ADR-0053 erweitert seit 2026-08-16 alle drei Pfade um den Präfix
`planning-history/<event-id>/`, den Kompaktionskatalog und dessen append-only Ereignisse.
Analysearchivierung bewahrt verifizierte Kaltpakete, Veranstaltungslöschung entfernt den exakt
zugehörigen Präfix, und ein bestätigter Werksreset berücksichtigt Katalog sowie optionale
R2-Bereinigung. Ein Bucket-Lifecycle ersetzt keinen dieser Anwendungspfade.
