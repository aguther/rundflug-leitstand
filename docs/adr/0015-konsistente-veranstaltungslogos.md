# ADR-0015: Konsistente Veranstaltungslogos in R2 und D1

- Status: Akzeptiert
- Datum: 2026-07-18
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: V15-BRAND-010

## Kontext

Ein Logo ist binär und für D1 ungeeignet. Eine getrennte Aktualisierung von Objektspeicher und
relationalem Verweis kann jedoch verwaiste Objekte oder ungültige Referenzen erzeugen. SVG benötigt
zusätzliche Inhaltsprüfung.

## Entscheidung

PNG, JPEG, WebP und SVG werden anhand Inhaltssignatur beziehungsweise SVG-Struktur geprüft und auf
1 MiB begrenzt. Aktive SVG-Inhalte, Eventhandler und externe Ressourcen werden abgelehnt. Zuerst
wird ein neuer eindeutiger R2-Schlüssel geschrieben, danach werden D1-Verweis, Audit,
Idempotenzbeleg und Outbox gemeinsam aktualisiert. Bei D1-Fehlern wird das neue Objekt entfernt; das
alte Objekt wird erst nach erfolgreicher Umschaltung gelöscht. Öffentliche Auslieferung setzt
`nosniff` und eine restriktive Content-Security-Policy.

## Folgen

Oberflächen laden das veranstaltungsbezogene Logo über eine stabile öffentliche Route. Ohne Logo
oder bei Ladefehler verwenden sie das einfache Plane-Symbol. Veranstaltungslöschung entfernt auch
das referenzierte Objekt.
