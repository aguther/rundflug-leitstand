# ADR-0036: Optionale FIDS-Zusammenfassung gemeinsamer Flüge

- Status: angenommen
- Datum: 2026-08-03
- Betroffene Anforderungen: F-MON-010, F-MON-040, F-BEN-090, V173-SET-010,
  V173-AUT-010, V173-QA-010, V1110-FID-010

## Kontext

Eine operative Flugzeugbelegung kann mehrere vollständig geschützte Buchungsgruppen enthalten.
Das FIDS zeigte bislang dennoch für jede Buchungsgruppe eine eigene Zeile. Bei hoher Auslastung
verbrauchte derselbe Flug dadurch mehrere Anzeigeplätze, obwohl Produkt, Gate und Status identisch
waren. Die G-Kennungen müssen weiterhin vollständig sichtbar bleiben, und ein aktiver Nachruf darf
nicht in einer Sammelzeile untergehen.

Außerdem wirkten prognosebedingte Ersatztexte bei bereits laufenden Zuständen irreführend. Für
`COME_TO_FLIGHT_LINE`, `BOARDING`, `IN_FLIGHT`, `LANDED` und `COMPLETED` ist der Zeitpunkt aus Sicht
des FIDS immer jetzt. Kürzlich abgeflogene Zeilen sollen während ihrer kurzen Nachlaufzeit direkt
hinter den handlungsrelevanten Aufrufen sichtbar bleiben.

## Entscheidung

Die konten- und veranstaltungsbezogenen FIDS-Präferenzen erhalten die standardmäßig deaktivierte
Option `groupSharedFlights`. Sie wird mit Expected-Version, Idempotenzbeleg, Audit und Outbox wie die
übrigen FIDS-Einstellungen gespeichert. Bestehende Displays behalten damit unverändert eine
Buchungsgruppe je Zeile.

Bei aktivierter Option gilt:

- `COME_TO_FLIGHT_LINE` wird nur innerhalb desselben Dispatch-Batches zusammengefasst.
- `BOARDING`, `IN_FLIGHT`, `LANDED` und `COMPLETED` werden nur innerhalb desselben bestätigten
  Umlaufs zusammengefasst.
- Produkt, Gate und öffentlicher Status müssen identisch sein.
- `WAITING`, `PREPARE`, `SERVICE_PAUSED` und Zeilen mit aktivem Nachruf bleiben einzeln.
- Eine physische FIDS-Zeile enthält höchstens drei G-Kennungen. Weitere Kennungen bilden eine
  weitere stabile Sammelzeile.
- Die Zusammenfassung erfolgt vor Fixed- und Split-Paging. Zähler und Seitenzahlen beziehen sich
  deshalb auf die tatsächlich angezeigten physischen Zeilen.
- Live-FIDS und Simulation verwenden dieselbe reine Gruppierungs-, Sortier- und Paginglogik.

Die Sammelzeilen-ID wird deterministisch aus Flugschlüssel, Produkt, Gate, Status und Chunkposition
gebildet. Das Hinzukommen einer zweiten oder dritten Gruppe ändert die Identität des ersten Chunks
nicht. Buchungsgruppensegmente auf unterschiedlichen Umläufen beziehungsweise Dispatch-Batches
bleiben getrennt.

Die Zeitfensterspalte zeigt für die genannten laufenden Zustände unabhängig vom Prognosezustand
`Jetzt`. In beiden FIDS-Modi folgen kürzlich abgeflogene Zeilen unmittelbar auf Boarding und
Gate-Aufrufe; sie verschwinden weiterhin nach der veranstaltungsweit konfigurierten Nachlaufzeit.
Diese Reihenfolge ersetzt ausschließlich die abweichende FIDS-Sortierreihenfolge aus ADR-0032.

## Folgen

- Displays können bei hoher Auslastung Platz sparen, ohne die öffentliche G-Kennung zu verlieren.
- Ein Nachruf bleibt visuell und fachlich genau einer Buchungsgruppe zugeordnet.
- Die geschützte Live-Projektion lädt die gefilterten physischen Zeilen vor dem Paging, damit
  Sortierung und eine aktivierte Zusammenfassung nicht an Seitengrenzen auseinanderfallen.
- Migration 0065 ist additiv, verwendet den kompatiblen Default `0` und bleibt wie andere
  FIDS-Präferenzen bewusst außerhalb portabler R2-Sicherungen.
