# ADR-0015: Konsistente Veranstaltungslogos in R2 und D1

- Status: Akzeptiert
- Datum: 2026-07-18
- Ergänzt: 2026-07-25
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: V15-BRAND-010, V173-FID-010

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

Je Veranstaltung werden unabhängige Varianten für das helle und dunkle Theme gespeichert. Die
bisherigen Spalten und die parameterlose Route bleiben die helle Variante. Eine angeforderte, nicht
vorhandene Variante fällt auf die vorhandene Gegenvariante zurück. Upload und Entfernen sind je
Variante versioniert, idempotent und auditiert; R2-Objekte werden erst nach erfolgreicher
Umschaltung beziehungsweise Entfernung des D1-Verweises gelöscht.

## Folgen

Oberflächen laden das veranstaltungsbezogene Logo über eine stabile öffentliche Route mit
`theme=light|dark`. Das FIDS verwendet seine eigene aufgelöste Theme-Einstellung. Ohne beide
Veranstaltungslogos oder bei Ladefehler verwenden kompakte Flächen die freigegebene
Rundflug-Leitstand-Marke; reine Produktflächen dürfen Marke und Wortmarke gemeinsam zeigen.
Veranstaltungslöschung entfernt beide referenzierten Objekte.
