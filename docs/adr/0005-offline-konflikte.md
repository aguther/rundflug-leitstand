# ADR-0005: Offline-Queue mit sichtbarer Konfliktauflösung

- Status: Akzeptiert, Detailregeln offen
- Datum: 2026-07-11

## Entscheidung

Die PWA hält den letzten bestätigten Snapshot und speichert zulässige Offline-Kommandos in IndexedDB.
Nach Wiederverbindung werden sie in Reihenfolge übertragen. Idempotenz und Expected-Version verhindern
Duplikate und stille Überschreibungen.

## Konfliktregel

Ein Konflikt wird dem Bediener mit aktuellem Serverzustand angezeigt. Das System führt keine
automatische fachliche Zusammenführung durch, wenn Gruppen, Slotbesetzung oder laufende Umläufe
betroffen sind.
