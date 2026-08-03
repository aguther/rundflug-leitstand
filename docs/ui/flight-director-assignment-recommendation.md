# Flight-Director-Belegung: konsistente Dispatch-Empfehlung

Status: freigegeben durch den Implementierungsauftrag für die Punkte A, B und C.

## Ziel

Der Belegungsdialog des Flight Directors zeigt beim ausdrücklichen Öffnen über eine
Flugzeugzeile genau die Gruppen, die der aktuelle Dispatch-Plan für dieses Flugzeug empfiehlt.
Empfehlung, sichtbare Auswahl und der mit `CALL_NEXT` übermittelte Dispatch-Bezug bilden damit
einen konsistenten Zustand.

Die Änderung führt keine neue Oberfläche ein. Sie präzisiert den bestehenden Ablauf aus
F-BRD-010, F-BRD-020, F-SLT-050, F-PRG-020, Q-UX-020 und Q-ZUV-020 sowie ADR-0012,
ADR-0019 und ADR-0032.

## Verbindliches Verhalten

1. **Dialog öffnen:** Ein Klick auf die primäre Belegungsaktion eines verfügbaren Flugzeugs wählt
   das Flugzeug und übernimmt dessen vollständige aktuelle Dispatch-Empfehlung in einem
   Zustandsübergang. Eine zuvor für ein anderes Flugzeug markierte Gruppe darf nicht sichtbar
   bleiben.
2. **Flugzeug wechseln:** Beim Wechsel von Flugzeug A zu Flugzeug B ersetzt die Empfehlung für B
   die Auswahl für A vollständig. Erneutes Öffnen von A stellt wieder die Empfehlung für A her.
3. **Keine Empfehlung:** Existiert für das gewählte Flugzeug keine aktuelle Empfehlung, öffnet
   der Dialog mit leerer Gruppenauswahl. Er erfindet keine Belegung und übernimmt keine alte
   Auswahl.
4. **Manuelle Abweichung:** Nach dem Öffnen darf der Flight Director Gruppen weiterhin bewusst
   ändern. Live-Aktualisierungen des Boards überschreiben diese manuelle Auswahl nicht. Erst ein
   erneuter ausdrücklicher Klick auf die Belegungsaktion wendet die dann aktuelle Empfehlung neu
   an.
5. **Bestätigung:** Entspricht die sichtbare Auswahl vollständig der aktuellen Empfehlung, sendet
   `CALL_NEXT` deren `planRevision` und `batchId`. Bei einer bewussten Abweichung bleibt die
   vorhandene Abweichungsbehandlung maßgeblich. Die serverseitige Prüfung
   `DISPATCH_PLAN_STALE` bleibt unverändert.
6. **Gleichzeitige Aktualisierung:** Auswahl und Flugzeugbezug dürfen während des Öffnens keinen
   beobachtbaren Zwischenzustand mit teilweise entfernten oder teilweise hinzugefügten Gruppen
   erzeugen.

## Zustände und Rückmeldungen

- **Aktuelle Empfehlung vorhanden:** Der vorhandene Empfehlungshinweis bleibt sichtbar; alle
  empfohlenen Gruppen sind ausgewählt.
- **Keine Empfehlung vorhanden:** Der vorhandene leere Dialogzustand wird verwendet; die Auswahl
  ist leer.
- **Veralteter Plan bei Bestätigung:** Die bestehende Serverfehlermeldung fordert eine
  Aktualisierung und erneute Prüfung. Es gibt keine automatische Bestätigung eines neueren Plans.
- **Manuelle Auswahl:** Die vorhandenen Kapazitäts-, Produkt- und Queue-Hinweise bleiben
  unverändert.

## Darstellung und Abnahme-Viewports

Es werden keine neuen Komponenten, Farben oder Layoutflächen eingeführt. Deshalb gelten die
bestehenden Flight-Director-Viewports und Kontrastvorgaben unverändert:

- Desktop in Light und Dark,
- Tablet in Light und Dark,
- Dialog mit einer Empfehlung, ohne Empfehlung und nach einem Flugzeugwechsel,
- Tastaturbedienung und sichtbarer Fokus gemäß bestehendem Dialogstandard.

## Nicht-Ziele

- keine Änderung der Dispatch-Prioritäten oder der serverseitigen Planrevision,
- keine automatische Neuauswahl allein durch Polling oder Push-Updates,
- keine Abschwächung der Pflicht zur manuellen Prüfung vor `CALL_NEXT`,
- keine neue lokale Parallelberechnung der Empfehlung in der UI.
