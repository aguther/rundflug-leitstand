# Flugzeugzentrierte Flight Line mit adaptivem Go-to-Gate

- Status: freigegeben
- Datum: 2026-07-18
- ADR: ADR-0012

## Ein-Bildschirm-Ablauf

1. Die Oberfläche zeigt Flugzeuge mit ihrem bestätigten Live-Zustand als primären Einstieg.
2. Ein verfügbares Flugzeug öffnet seine Ressourcengruppen-Queue in stabiler Reihenfolge.
3. Sichtbar sind ausschließlich ganze passende Buchungsgruppen, Anwesenheit, Gruppengröße,
   Warteverlauf und begründete Ausnahmen.
4. Die Flight Line wählt den vorgeschlagenen Umlauf mit seinen vollständig passenden Gruppen für die
   vorläufige Belegung des konkreten Flugzeugs. Diese Auswahl ist noch keine flugbetriebliche Freigabe.
5. „Belegung bestätigen & Boarding starten“ bindet Flugzeug und anonymen Pilotencode, schreibt das
   auditierte Ist-Ereignis und beginnt die Boardingmessung.
6. Danach bleiben `IM FLUG`, `GELANDET` und `ABGESCHLOSSEN/VERFÜGBAR` beobachtete Primärereignisse.

## Queue- und Anwesenheitsausnahmen

Die vorderste passende Gruppe bleibt sichtbar, auch wenn Personen fehlen. Sie wird nicht automatisch
übergangen. Zulässige menschliche Entscheidungen sind gemeinsame Zurückstellung, No-Show nach Frist,
unvollständige Mitnahme oder ein bewusst leer gelassener Platz. Jede Abweichung erzeugt einen
append-only Audit-Eintrag. Gruppen werden niemals automatisch getrennt.

## Automatischer Voraufruf

`GO TO GATE` besitzt im Standardablauf keinen manuellen Primärknopf. Die Oberfläche zeigt lediglich,
dass der automatische Voraufruf aktiv ist, wann das nächste Boardingfenster ungefähr erwartet wird
und ob die Prognose stabil, veränderlich oder unsicher ist. Unterbrechung und Notfall sperren neue
Voraufrufe, ohne bereits bestätigte Daten zu verwerfen.

## Oberflächenstruktur

- Desktop Supervisor: Flugzeugleiste, Arbeitsbereich mit geordneter Queue, Belegungsleiste und knappe
  Aktivitätshistorie in einem Bildschirm.
- Assist: Flugzeugauswahl, passende ganze Gruppen und eine fixierte Bestätigungsaktion für das
  gewählte Flugzeug.
- Keine Gastnamen, keine stillen Queue-Sprünge, keine generischen Dashboard-Karten und höchstens eine
  hervorgehobene Primäraktion pro Arbeitszustand.

## Freigegebene visuelle Referenzen

- Desktop: `aircraft-centered-flight-line-desktop.png`
- Mobil: `aircraft-centered-flight-line-mobile.png`

Die Freigabe erfolgte im Gespräch am 18.07.2026 zusammen mit der Festlegung, dass Veranstaltungen
typischerweise einen Betriebstag dauern. Deshalb lernt die adaptive Steuerung vorrangig innerhalb des
aktuellen Veranstaltungstags; historische Daten bleiben ein Startwert für den Tagesbeginn.
