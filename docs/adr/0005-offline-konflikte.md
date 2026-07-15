# ADR-0005: Offline-Queue mit sichtbarer Konfliktauflösung

- Status: Akzeptiert
- Datum: 2026-07-11

## Entscheidung

Die PWA hält den letzten bestätigten Snapshot und speichert zulässige Offline-Kommandos in IndexedDB.
Nach Wiederverbindung werden sie in Reihenfolge übertragen. Idempotenz und Expected-Version verhindern
Duplikate und stille Überschreibungen.

## Konfliktregel

Ein Konflikt wird dem Bediener mit aktuellem Serverzustand angezeigt. Das System führt keine
automatische fachliche Zusammenführung durch, wenn Gruppen, Slotbesetzung oder laufende Umläufe
betroffen sind.

Die Detailregeln wurden mit OQ-01 und OQ-12 freigegeben: Operativ wirksame Kommandos benötigen eine
Serverbestätigung. Der veranstaltungsbezogene Durable Object serialisiert sie nach Servereingang;
Expected-Version und Invarianten entscheiden. Der erste gültige Schreibbefehl gewinnt technisch,
jeder veraltete Konflikt wird sichtbar abgelehnt und muss von der zuständigen Rolle als neues
Kommando entschieden werden. Not-Halt besitzt einen autorisierten Sofortpfad, überschreibt aber
keine Historie.
