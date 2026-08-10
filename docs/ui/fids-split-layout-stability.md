# FIDS-Splitdarstellung: fachliches und visuelles Konzept

Stand: 2026-08-02
Anforderungen: V15-FIDS-020, V173-PRI-010, V173-LAY-010, V173-SET-010, V173-QA-010

## Ziel und Abgrenzung

Die bestehende FIDS-Gestaltung bleibt erhalten. Korrigiert werden ausschließlich die fachliche
Partitionierung der SPLIT-Ansicht, der Ablauf kürzlich abgeflogener Zeilen, die Seiteninformation,
die Textdarstellung sowie die geometrische Stabilität. Die veranstaltungsweite Einstellung
`departedVisibilitySeconds` bleibt die einzige Quelle für die Sichtbarkeitsdauer; sie wird nicht Teil
der kontobezogenen FIDS-Einstellungen. Die anonyme Public-Board-Sortierung und der FIXED_PAGE-Vertrag
bleiben unverändert.

## Reproduzierter Ausgangszustand

Die Vorher-Prüfung erfolgte am 2026-08-02 mit dem synthetischen Prognose-Simulator in einer
SPLIT-Ansicht mit acht Anzeigeplätzen und drei reservierten oberen Plätzen. Beobachtet wurden leere,
teilweise und vollständig belegte Bereiche, mehrere untere Seiten, BOARDING und
COME_TO_FLIGHT_LINE sowie der Übergang einer BOARDING-Gruppe in den Abflugstatus. Zusätzlich wurden
lange synthetische Gruppen-, Produkt-, Gate- und Zeitfenstertexte bei 1600 × 900 und 640 × 900
geprüft.

- Eine globale, absolut positionierte Empty-State-Fläche lag bei leerem Board über beiden
  Split-Bereichen. Ihr gemessener Bereich reichte von y = 261 px bis y = 807 px; dadurch wurden
  „WEITERE FLÜGE“ und die unteren Spaltenüberschriften sichtbar abgeschwächt.
- Bei 640 × 900 waren obere Zeilen 54,03 px und untere Zeilen 65,42 bis 65,44 px hoch. Die Differenz
  von 11,41 px überschritt das Abnahmelimit von 1 CSS-Pixel deutlich.
- Nach dem Übergang BOARDING → Abflug verschwand die betroffene Gruppe aus „JETZT RELEVANT“. Die
  bisherige Split-Partition behandelt IN_FLIGHT, LANDED und COMPLETED nicht als verpflichtende obere
  Kategorie; eine solche Zeile kann deshalb in die untere Menge beziehungsweise hinter deren
  Seitengrenze geraten.
- „WEITERE FLÜGE“ enthielt keine Seiteninformation; gleichzeitig zeigte der Footer redundant
  „Unterseite 1“.
- Zeitfenster erschienen noch als „ca. 10:37 – 10:47“. Lange Inhalte wurden teilweise an Zellkanten
  abgeschnitten, und die kritischen Zellen erlaubten pauschales `overflow-wrap: anywhere`.
- Das Setup verwendete die abstrakten Bezeichnungen „Sichtbare Gruppen“, „Prioritätsplätze“ und
  „Wechselintervall (Sek.)“ und erklärte die veranstaltungsweite Abflugfrist nicht.

## Fachliche Split-Partitionierung

Die vom Backend vorgegebene Reihenfolge bleibt innerhalb eines Bandes maßgeblich. Die obere Sektion
„JETZT RELEVANT“ wird in dieser Reihenfolge gebildet:

1. **Handlungsrelevant:** BOARDING und COME_TO_FLIGHT_LINE.
2. **Kürzlich abgeflogen:** IN_FLIGHT, LANDED und COMPLETED, neueste `departedAt` zuerst. Diese Zeilen
   sind nur Kandidaten, solange die Server- beziehungsweise Simulationsprojektion sie innerhalb der
   bestehenden veranstaltungsweiten Abflugfrist liefert.
3. **BEREITHALTEN:** PREPARE füllt anschließend noch freie reservierte obere Plätze.

Handlungsrelevante und kürzlich abgeflogene Zeilen sind verpflichtende obere Kategorien. Gemeinsam
dürfen sie die konfigurierte Reservierung bis zur Gesamtzahl sichtbarer Anzeigeplätze erweitern.
Reicht selbst die Gesamtkapazität nicht aus, werden zuerst die handlungsrelevanten und anschließend
die neuesten Abflugzeilen gezeigt. `overflowCount` zählt dann alle nicht sichtbaren verpflichtenden
oberen Einträge; der sichtbare Hinweis lautet „weitere relevante Gruppen“.

Die untere Menge „WEITERE FLÜGE“ enthält alle übrigen darstellbaren Zeilen. Sie schließt die beiden
verpflichtenden oberen Kategorien vollständig aus, nicht nur deren aktuell sichtbare IDs. PREPARE,
das keinen reservierten oberen Platz erhält, bleibt unten. Zusätzlich werden die tatsächlich oben
verwendeten PREPARE-`rowId`s stabil ausgeschlossen. Oberer Bereich, oberer Überlauf und untere
Seitenergebnisse bleiben damit disjunkt.

## Kapazität und Überlauf

Eine reine Domain-Funktion plant aus Gesamtplätzen, oberer Reservierung sowie den Anzahlen der
handlungsrelevanten und kürzlich abgeflogenen Zeilen:

- die maximal zu ladenden Einträge je verpflichtendem Band,
- die verbleibende PREPARE-Kapazität,
- die effektive obere Kapazität,
- die untere Seitengröße und
- den relevanten oberen Überlauf.

Worker und Simulation verwenden denselben Plan. Die effektive obere Kapazität bleibt mindestens so
groß wie die konfigurierte Reservierung und wächst nur in vollständigen Anzeigeplätzen. FIXED_PAGE
verwendet weiterhin die bestehende unveränderte Gesamtprojektion und URL-Seite.

## Sekundengenauer Ablauf und Offlineverhalten

Nach jeder bestätigten Boardantwort bestimmt der gemeinsame Controller unter den sichtbaren
IN_FLIGHT-, LANDED- und COMPLETED-Zeilen die früheste Ablaufzeit
`departedAt + departedVisibilitySeconds`. Kurz nach diesem Zeitpunkt löst ein aufräumbarer One-shot-
Timer genau einen regulären Refresh über die aktive Datenquelle aus. Der Server beziehungsweise die
Simulationsprojektion entscheidet weiterhin, ob die Zeile abgelaufen ist; der Client entfernt keine
bestätigte Zeile lokal.

Ein bereits versuchter, aber vom Server nochmals gelieferter Ablaufzeitpunkt wird nicht in einer
schnellen Schleife erneut geplant. Das bestehende 15-Sekunden-Polling bleibt Fallback. Board- oder
Datenquellenwechsel und Unmount ersetzen beziehungsweise entfernen den Timer vollständig. Schlägt der
Ablauf-Refresh offline fehl, bleibt das letzte bestätigte Board sichtbar; nur der bestehende
Fehler-/Verbindungszustand ändert sich.

## Gemeinsames Zeilenmodell

Der sichtbare Boardbereich besitzt feste Höhen für Abschnittsüberschriften, Spaltenüberschriften und
die Lücke zwischen den Split-Bereichen. Die verbleibende Höhe wird durch die Summe aller physischen
Zeilenspuren geteilt. Beide Sektionen verwenden denselben berechneten Track-Wert.

- In SINGLE entspricht eine Anzeigezeile einer physischen Spur.
- In DOUBLE wird je Sektion die tatsächlich benötigte Spurzahl `ceil(Anzeigeplätze / 2)` verwendet;
  ein kontrollierter Rückfall auf SINGLE erfolgt unterhalb des bestehenden breiten Breakpoints.
- Eine Änderung der effektiven oberen Kapazität verschiebt die Abschnittsgrenze nur um vollständige
  gemeinsame Spuren.
- Jede Sektion rendert ihre konfigurierte Slotzahl deterministisch. Nicht belegte Slots bleiben
  neutrale, explizite Grid-Spuren und werden nicht durch inhaltsabhängige implizite Zeilen ersetzt.
- Inhalt darf die Track-Höhe nicht vergrößern. Die zulässige Differenz zwischen kleinster und größter
  regulärer sichtbarer Zeile beträgt in jedem Abnahme-Viewport höchstens 1 CSS-Pixel.

## Abschnittsköpfe, Empty States und Fehler

„WEITERE FLÜGE“ erhält im gleichen festen Abschnittskopf rechts die Seiteninformation
„SEITE 1 / 3“. Bei genau einer nicht leeren Seite wird konsistent ebenfalls „SEITE 1 / 1“ gezeigt.
Unter sehr schmalen Bedingungen darf nur der Präfix entfallen, sodass „1 / 3“ stehen bleibt. Bei
`totalItems = 0` entfällt die Seiteninformation. Der normale SPLIT-Footer enthält keine
„Unterseite“-Aussage mehr; die feste URL-Seite im FIXED_PAGE-Modus bleibt im Footer erhalten.

Empty States liegen ausschließlich im Körper ihres Bereichs und besitzen keine flächige
Abdunkelung:

- oben: „Derzeit keine unmittelbar relevanten Gruppen.“
- unten: „Derzeit keine weiteren Gruppen.“
- FIXED_PAGE: „Aktuell keine Gruppen auf dieser Seite.“

Abschnittstitel, Spaltenköpfe, Rahmen, Nachbarbereich und Footer bleiben dabei vollständig sichtbar.
Liegt beim Initialabruf noch kein bestätigtes Board vor, erscheint ein klar abgegrenzter Fehlerzustand
im festen Tabellenkörper. Ein späterer Fehler überdeckt oder ersetzt ein bereits bestätigtes Board
nicht.

Wird eine untere Seite durch Realtime- oder Filteränderung ungültig, übernimmt der Controller die
Antwort nicht als sichtbares Board. Er setzt `lowerPage` unmittelbar auf Seite 1 und lädt diese neu;
bis zur gültigen Antwort bleibt das letzte bestätigte Board stehen. Die FIXED_PAGE-URL wird gemäß
ADR-0039 niemals automatisch umgeschrieben.

## Lange Inhalte und Typografie

FIDS verwendet die kompakte Zeitfenstervariante ohne „ca.“ und „Uhr“, beispielsweise
„18:20–18:40“. Zeitwerte verwenden tabellarische Ziffern und bleiben ebenso wie Gruppencode und
Status einzeilig. Die kompakte Gruppenzelle darf aus genau zwei jeweils einzeiligen Ebenen bestehen:
Gruppencode und Produktname.

Die FIDS-spezifischen Ersatztexte lauten „Heute nicht mehr“, „Rückkehr offen“, „Statusklärung“ und
„Aktualisierung“. „Keine passende Kapazität“ bleibt erhalten, solange die Messung zeigt, dass es in
den unterstützten Viewports kontrolliert darstellbar ist. Produkt- und Gatebezeichnungen werden als
letzte Rückfallebene mit Ellipse gekürzt; vollständiger Text bleibt über `title` und eine zugängliche
Beschriftung verfügbar. Kritische Zellen verwenden kein pauschales `overflow-wrap: anywhere`.
BOARDING, BITTE ZUM GATE, BEREITHALTEN, ABGEFLOGEN und ABGESCHLOSSEN bleiben vollständig lesbar.
Lucide-Symbole bleiben auf Texthöhe.

## Breite, schmale, ein- und zweispaltige Darstellung

Ab dem bestehenden DOUBLE-Breakpoint werden zwei Tabellenspalten verwendet. Beide Spalten teilen
Spaltenkopf-, Track- und Textregeln. Unterhalb des Breakpoints fällt DOUBLE kontrolliert auf eine
Spalte zurück, ohne Datenverlust oder Neuberechnung der fachlichen Reihenfolge. Responsive Schrift-
und Abstandswerte dürfen schrumpfen; Slot- und Abschnittshöhen bleiben inhaltsunabhängig. Auch bei
640 px Breite entstehen weder horizontaler Dokument-/Board-/Tabellenscroll noch abgeschnittene
Spaltenüberschriften. Light und Dark verwenden identische Geometrie.

## Setup-Wording und Fokusverhalten

Im SPLIT-Setup werden die Bezeichnungen „Anzeigeplätze gesamt“, „Oben reservierte Plätze“ und
„Seitenwechsel unten“ verwendet. Direkt darunter steht dynamisch beispielsweise:
„Oben: 3 reservierte Plätze · unten: 5 Plätze je Seite“.

Ein nicht fokussierbarer Hilfeblock erklärt, dass BOARDING und BITTE ZUM GATE zuerst oben stehen,
kürzlich abgeflogene Gruppen für die veranstaltungsweit konfigurierte Dauer folgen, BEREITHALTEN
freie reservierte Plätze füllt und nur die übrigen Gruppen unten rotieren. Der Read-only-Hinweis zeigt
beispielsweise: „Abgeflogene Gruppen bleiben 15 Sek. oben sichtbar. Änderbar unter Administration →
Veranstaltungsparameter.“ Es wird kein neues Einstellungsfeld angelegt. Der Dialog behält festen Kopf
und Footer sowie genau einen internen Scrollbereich; informative Texte erzeugen keine Tabstopps.

## Abnahme

Die Umsetzung wird in FIXED_PAGE und SPLIT, SINGLE und DOUBLE samt Rückfall, Light und Dark sowie Live
und Simulation geprüft. Neben 1920 × 1080, 1440 × 900, 1280 × 720, 1024 × 768, 800 × 600 und
640 × 600 wird eine schmale hohe Ansicht geprüft. Die Zustandsmatrix umfasst 0, 1, volle und
überlaufende Ergebnismengen, mehrere untere Seiten, lange Inhalte, aktiven Nachruf, Highlight-Wechsel,
BOARDING → IN_FLIGHT → Fristablauf sowie die Reduzierung von `totalPages`. Geometrisch werden
Horizontalüberlauf, Überdeckungen, vollständige Überschriften, konstante Slotpositionen, genau ein
Dialog-Scrollbereich und die maximale Zeilenhöhendifferenz von 1 CSS-Pixel gemessen.
