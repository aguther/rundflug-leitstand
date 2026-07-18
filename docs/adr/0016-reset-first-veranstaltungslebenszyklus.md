# ADR-0016: Reset-first-Veranstaltungslebenszyklus und öffentliches FIDS

- Status: Akzeptiert; ersetzt die Archivierungs- und Displaykopplungsanteile aus ADR-0013
- Datum: 2026-07-18
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: V15-FIDS-010, V15-EVT-010, V15-EVT-020, V15-EXP-010, V15-ARCH-010

## Kontext

Das System befindet sich im Testbetrieb. Dauerarchive, komplexe Rückwärtsmigrationen und gekoppelte
Anzeigegeräte erhöhen derzeit die Komplexität, ohne einen angemessenen Nutzen zu liefern. Operativ
wertvoll sind vor allem anonyme Messwerte als Schätzgrundlage für den nächsten Flugtag.

## Entscheidung

Veranstaltungen können nach exakter ID-Bestätigung vollständig gelöscht werden. Wird die letzte
Veranstaltung entfernt, kehrt das System zur Ersteinrichtung zurück. Vorher kann ein anonymes
Leistungsprofil mit Flugplatz, Datum, Flottenkontext und gemessenen Prozesszeiten exportiert werden.
Bis zum Produktivbetrieb wird nach strukturellen Updates ein frischer Datenstand bevorzugt; eine
aufwendige Migration historischer Testdaten ist kein Standardziel.

FIDS-Daten sind anonym und ohne Gerätekopplung über die veranstaltungsbezogene URL abrufbar. Kenntnis
der URL ist die einzige Zugangshürde; administrative Konfiguration bleibt geschützt.

## Folgen

ADR-0013 bleibt für die bewusste interne Veranstaltungsauswahl gültig. Seine Festlegungen zur
dauerhaften Displaykopplung und Archivierung gelten nicht mehr. Parallelbetrieb und dauerhafte
Mandanten-/Archivkonzepte werden neu bewertet, bevor ein kommerzieller Produktivbetrieb beginnt.
