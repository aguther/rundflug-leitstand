# Freigegebenes Administrationskonzept V1

Status: fachlich und visuell am 13.07.2026 freigegeben.

Referenz: `admin-ux-v1-approved.png`

## Informationsarchitektur

Die Administration trennt fünf Arbeitsbereiche:

1. **Übersicht** – Betriebsstatus und Kennzahlen, ohne Stammdatenformulare.
2. **Einrichtung** – geführte Reihenfolge Parameter, Gates, Ressourcengruppen, Flugzeuge,
   Zuordnungen, Piloten, Produkte und Betriebsfreigabe.
3. **Stammdaten** – sichtbare Listen und Editoren für Gates, Ressourcengruppen, Flugzeuge,
   Piloten-IDs und Produkte.
4. **Betrieb** – laufende Umläufe, Hinweise, Kapazität, Flottenzustand und Notfallmodus.
5. **Sicherung & Reset** – Veranstaltungen, Neustartstufen, Geräte, Exporte und Audit-Historie.

## Interaktionsregeln

- Bestehende Datensätze stehen in sichtbaren Tabellen oder Listen; Auswahlfelder sind nicht die
  einzige Möglichkeit, einen Datensatz wiederzufinden.
- Abhängigkeiten werden am Ort der Aktion erklärt. Beispiel: Eine Flugzeugzuordnung setzt eine
  Ressourcengruppe voraus.
- Deaktivierte Aktionen erhalten eine sichtbare Begründung. Validierungsfehler werden inline
  angezeigt und nicht nur durch einen deaktivierten Button ausgedrückt.
- Änderungen verwenden weiterhin Administrator-PIN, Begründung, erwartete Version und den
  bestehenden auditierten Schreibpfad.
- Stammdaten werden deaktiviert beziehungsweise historisiert; fachliche Historie wird nicht
  stillschweigend gelöscht.
- Es werden ausschließlich technische IDs, Kennungen und anonyme Pilotencodes angezeigt.

## Visuelles System

- Hintergrund: Weiß für den Arbeitsbereich, sehr helles kühles Grau für die Navigation.
- Text: tiefes Navy; primäre Aktionen und Auswahl: zurückhaltendes Luftfahrtblau.
- Semantik: Grün, Gelb und Rot ausschließlich für fachliche Zustände und Warnungen.
- Container: offene Listen und Tabellen; nur der aktive Editor erhält eine leichte Hervorhebung.
- Radien: 6–10 px; klare 1-px-Trennlinien; keine dekorativen Verläufe oder Kennzahlen-Kartenraster
  in der Stammdatenpflege.
- Desktop ist die primäre Arbeitsfläche. Unterhalb des Tablet-Breakpoints werden Navigation,
  Fortschritt, Tabellen und Editor linear angeordnet; Tabellen bleiben horizontal erreichbar.

## Bewusste funktionale Präzisierung gegenüber dem Bild

Der rote Beispielhinweis „Keine Fehler gefunden“ im visuellen Entwurf wird nicht umgesetzt. Ein
Fehlerbereich erscheint nur bei tatsächlichen Validierungsproblemen; bei gültigen Eingaben bleibt
die Aktion aktiv. Diese Abweichung ist erforderlich, damit Farbe und Aussage semantisch korrekt
bleiben.
