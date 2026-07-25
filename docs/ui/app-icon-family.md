# Freigegebene App-Icon-Familie

- Status: freigegeben
- Datum: 2026-07-25
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: T-010, Q-UX-040

## Gestaltungsprinzip

Alle App-Icons basieren auf einem 48er-Raster. Der amberfarbene Rundkurs besitzt die einheitliche
Strichstärke 2,4 und eine Öffnung mit Knoten. Die innere Lucide-Glyphe wird optisch zentriert und
auf dieselbe sichtbare Strichstärke ausgeglichen. Unter 24 Pixeln wird die kräftigere Kleinformat-
Fassung verwendet.

| Rolle | Farbe |
|---|---|
| Tinte und App-Hintergrund | `#0D1B26` |
| Rundkurs und Knoten | `#FFB020` |
| Negativglyphe | `#E6EDF3` |

## Markenfamilie

| Identität | Glyphe | Laufzeitprofil |
|---|---|---|
| Rundflug Leitstand | `plane-takeoff` | `brand` |
| Kasse | `tickets` | `kasse` |
| Flight Director | `users` | `flight-director` |
| Flight Line | `headphones` | `flight-line` |
| FIDS | `monitor` | `fids` |
| Administration | `settings` | `admin` |
| Ticket- und Gruppenstatus | `ticket` | `ticket` |

Die vollständige Referenz einschließlich Vektoren, Plattformexporten, Inventar, Übersicht und
Generator liegt unter `docs/ui/icon-system/`. Der ausgelieferte Minimalsatz liegt unter
`apps/web/public/icons/pwa/`.

## Verwendungsregel

Die gerahmte Marke steht allein: als Browser-Favicon, PWA-Installationsicon, Home-Screen-Symbol,
Kachel, Ladebildschirm oder Briefkopf. Sie ersetzt keine Bedien- oder Navigationssymbole.
Insbesondere behält das Ansichtsmenü die vorhandenen puren Lucide-Glyphen `Tickets`, `Users`,
`Headphones`, `Plane` und `Settings`.

Jedes Laufzeitprofil enthält:

- ein farbmodusfähiges SVG-Favicon,
- ein deckendes Apple-Touch-Icon mit 180 Pixeln und ohne vorgerundete Ecken,
- reguläre Android-/PWA-Icons mit 192 und 512 Pixeln,
- separate deckende Maskable-Icons mit 192 und 512 Pixeln und sicherem Innenbereich.

Manifest-ID, Startpfad, Scope, Name und die Oberflächenfarben bleiben von der Iconfamilie
unverändert. FIDS und FIDS-Terminal teilen sich ein Profil. Ticket und Buchungsgruppe teilen sich
die Ticketmarke, behalten aber jeweils ihr dynamisches Manifest und ihren exakten Startpfad.

## Ablösung

Diese Freigabe ersetzt die frühere Vorgabe aus `V19-BRN-010`, das blaue generische Plane-Icon und
die damaligen ansichtsspezifischen Symbole unverändert zu lassen. Die historischen
Releaseanforderungen bleiben als zeitgebundene Dokumentation erhalten.
