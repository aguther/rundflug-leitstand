# ADR-0037: Teilflug-Suffixe in konkreten Umlaufzeilen

- Status: angenommen
- Datum: 2026-08-06
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: F-MON-010, F-MON-020, F-MON-040, V18-FLT-010,
  V18-GRP-010

## Kontext

Eine bewusst aufgeteilte Buchungsgruppe kann gleichzeitig mehreren nicht abgeschlossenen Umläufen
zugeordnet sein. Die reine G-Kennung bezeichnet weiterhin die verbundene Buchungsgruppe und ist in
aggregierten Gruppenansichten korrekt. In einer konkreten FIDS- oder Operationszeile ließ sie jedoch
nicht erkennen, welcher aktuelle Teilflug gemeint ist. Personenticketnummern sind dafür ungeeignet,
weil sie eine andere Identität besitzen und zusammengefasste Flugzeilen mehrere Buchungsgruppen
enthalten können.

Die bestehende kanonische Teilflugprojektion ermittelt bereits deterministisch Teilflugnummer,
Teilfluganzahl und Personenzahl aus nicht freigegebenen Ticketzuordnungen zu nicht stornierten
Umläufen. Diese Werte werden nicht persistiert und dürfen sich nach einer bewussten operativen
Umbesetzung entsprechend der bestehenden Regel neu ergeben.

## Entscheidung

Konkrete umlaufbezogene Darstellungen ergänzen die G-Kennung genau dann um `/<Teilflugnummer>`, wenn
die kanonische Projektion mehr als einen aktuellen Teilflug ausweist. Eine zweigeteilte Gruppe
erscheint damit beispielsweise als `G-RN-0106/1` und `G-RN-0106/2`; eine ungeteilte Gruppe bleibt
`G-RN-0106`.

Die Regel gilt für:

- FIDS-Zeilen einschließlich aller G-Kennungen in einer zusammengefassten Flugzeile,
- die aktuelle Belegung und Historie in Flight Line und Flight Director,
- umlaufbezogene Flugzeug-Chips, verkaufte Tickets und Analysezeilen.

Aggregierte Gruppenansichten behalten die reine G-Kennung. Dazu gehören Kasse, Suche,
Gruppenticket, der Kopf des öffentlichen Gruppenstatus, gruppenweite Analyseauswahl sowie noch nicht
zugeordnete Queue-Einträge. Bereits vorhandene Erläuterungen wie „Teilflug 1 von 2“ im öffentlichen
Status bleiben unverändert. `ticketLabels` dienen weder als Quelle noch als Ersatz für die
Teilflugkennung.

Die gemeinsame Domain-Formatierung akzeptiert nur positive ganzzahlige Werte mit
`partNumber <= partCount`. `OperationBoard.rotations[].bookingGroups[]` transportiert `partNumber`
und `partCount` additiv mit dem kompatiblen Standardwert `1`. Das FIDS-Schema bleibt strukturell
unverändert; die sichtbaren `bookingGroupLabels` erhalten die präzisierte Semantik.

## Folgen und Abgrenzung

- Die Kennung ist innerhalb der aktuellen operativen Aufteilung eindeutig, erzeugt aber keine neue
  fachliche oder persistierte Identität.
- Freigegebene Zuordnungen und stornierte Umläufe beeinflussen weder Nummerierung noch Anzahl.
- Die Darstellung bleibt in derselben typografischen Zeile; es entstehen keine neuen Chips,
  Zeilen oder Layoutsprünge.
- Die Änderung besitzt keine Freigabe-, Sicherheits- oder flugbetriebliche Semantik.
- Es ist keine Datenbankmigration und keine Wiederherstellungsmaßnahme erforderlich. Ein Rollback
  besteht ausschließlich in der Rücknahme von Formatierung, Projektion und additiven Vertragsfeldern.

Domain-, Contract-, Worker- und React-DOM-Tests decken ungeteilte und geteilte Kennungen,
ungültige Teilflugwerte, die kanonische Projektion sowie konkrete und aggregierte Oberflächen ab.
Die Browserabnahme prüft FIDS, Flight Line und Flight Director in den freigegebenen hellen und
dunklen Viewports.
