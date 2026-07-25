# Rundflug Leitstand — Icon-Set

Alles ist aus einer einzigen Geometrie erzeugt: 48er-Raster (exakt 2 × Lucide),
Strichstärke 2.4 (entspricht 1.2/24). Der Generator liegt bei, das Set lässt
sich damit jederzeit neu ausgeben.

> **Hinweis:** `generator.py` erneuert nur `marke/` und `module/`.
> `README.md`, `INVENTAR.md` und `uebersicht.html` bleiben erhalten.

`INVENTAR.md` listet jede erzeugte Datei nach Marke und Ordner auf.

## Verwendung im Repository

Dieser Ordner ist die kanonische, nicht ausgelieferte Designreferenz. Die PWA verwendet nur den
schlanken Laufzeitsatz unter `apps/web/public/icons/pwa/`. Die Dateien in den `einbau/`-Ordnern
dokumentieren das gelieferte Exportformat; verbindlich für die Anwendung sind die Manifeste und
Metadaten in `apps/web` und `apps/worker`.

| Referenz | Laufzeitname | Verwendung |
|---|---|---|
| `marke/` | `brand` | Root-Favicon und generische PWA |
| `module/kasse/` | `kasse` | Kasse |
| `module/flight-director/` | `flight-director` | Flight Director |
| `module/flight-line/` | `flight-line` | Flight Line |
| `module/fids/` | `fids` | FIDS und FIDS-Terminal |
| `module/administration/` | `admin` | Administration |
| `module/ticket/` | `ticket` | Ticket- und Gruppenstatus |

Die gerahmten Marken sind ausschließlich für alleinstehende Identitäten wie Favicon, installierte
PWA, Kachel, Ladebildschirm oder Briefkopf bestimmt. Das Ansichtsmenü und andere Bedienelemente
verwenden weiterhin die puren Lucide-Glyphen.

Der Generator schreibt relativ zu seinem eigenen Speicherort. Er ist ein optionales Designwerkzeug
und kein Bestandteil des Anwendungsbuilds. Für eine bewusste Neuerzeugung werden Python,
`CairoSVG` und `Pillow` benötigt:

```bash
python -m pip install CairoSVG Pillow
python docs/ui/icon-system/generator.py
```

Die verwendeten Lucide-Glyphen und ihre Lizenz sind in `LICENSE-LUCIDE.txt` dokumentiert.

## Aufbau der Marken

Jede Marke besteht aus drei Teilen:

1. **Bogen** — Kreis r = 21, Öffnung 42° zwischen 24° und 66°, in Amber.
2. **Knoten** — Radius 2.24 auf 45°, füllt die Öffnung.
3. **Glyphe** — ein Lucide-Pfad, zentriert eingesetzt.

Bogen und Knoten bleiben über die ganze Familie identisch. Nur die Glyphe wechselt.
Alle Glyphen sind unveränderte Originalpfade aus dem Lucide-Repository — einzige
Ausnahme ist die auf 18 Einheiten gekürzte Bodenlinie der Hauptmarke.

| Marke | Lucide-Glyphe | Ordner |
|---|---|---|
| Rundflug Leitstand | `plane-takeoff` | `marke/` |
| Kasse | `tickets` | `module/kasse/` |
| Flight Director | `users` | `module/flight-director/` |
| Flight Line | `headphones` | `module/flight-line/` |
| FIDS | `monitor` | `module/fids/` |
| Ticket | `ticket` | `module/ticket/` |
| Administration | `settings` | `module/administration/` |

### Kasse und Ticket

`tickets` steht für die Ausgabe, `ticket` für das einzelne Dokument — Stapel gegen
Einzelstück. Die Silhouetten unterscheiden sich deutlich genug, solange beide nicht
direkt untereinander stehen. Falls das doch vorkommt, sollte eine der beiden Marken
auf ein anderes Zeichen wechseln.

### Administration

`settings` ist die rundeste Glyphe der Familie — ein Kreis im Kreis. Geometrisch
sitzt sie am großzügigsten von allen, formal ist sie der schwächste Kandidat,
weil sie die Rundung des Bogens wiederholt statt ihr etwas entgegenzusetzen.
Alternativen mit kantiger Silhouette wären `sliders-horizontal`, `wrench` oder
`shield-check`. Für die Beibehaltung spricht, dass das Zahnrad in der Navigation
bereits etabliert ist.

### Optische statt mathematischer Größe

`plane-takeoff` ist flach und breit, die Modul-Glyphen sind kompakt und quadratisch.
Bei gleichem Skalierungsfaktor wirken letztere deutlich größer. Deshalb steht die
Hauptmarke auf Faktor 1.2, die Modul-Glyphen auf 1.1. Die gerenderte Strichstärke
wird jeweils gegengerechnet und liegt überall bei 2.4.

### Geprüfte Abstände

Kleinster gemessener Abstand zwischen Glyphe und Bogen, in Rastereinheiten:

| Marke | Abstand |
|---|---|
| Rundflug Leitstand | 1.78 |
| Kasse | 3.38 |
| Flight Director | 2.72 |
| Flight Line | 3.94 |
| FIDS | 2.72 |
| Ticket | 4.12 |
| Administration | 5.16 |

## Einbau in die Navigation

**In der Seitenleiste die puren Lucide-Glyphen verwenden, nicht die gerahmten.**
Fünf Ringe untereinander sind auf einen Blick nicht unterscheidbar — der Rahmen
kostet genau die Trennschärfe, für die Navigationsicons da sind.

Die gerahmte Fassung gehört dorthin, wo ein Icon allein steht: App-Symbol,
Favicon, Kachel, Ladebildschirm, Briefkopf.

## Ordner je Marke

| Ordner | Inhalt |
|---|---|
| `svg/` | `icon.svg` (einfarbig, `currentColor`), `icon-zweifarbig.svg`, `icon-negativ.svg`, `icon-klein.svg`, `favicon.svg`, `app-icon.svg`, `app-icon-maskable.svg` |
| `png-icon/hellgrund/` | 16–512 px in Tinte, für helle Oberflächen |
| `png-icon/dunkelgrund/` | 16–512 px in Hell, für dunkle Oberflächen |
| `favicon/` | 16/32/48/96 px, `favicon.ico` (drei Größen), `apple-touch-icon-180.png` |
| `app-ios/` | 120/152/167/180/1024 px, deckend, **ohne** Eckenrundung |
| `app-android/` | 48–512 px mit Eckradius, `maskable-192/512.png` mit Sicherheitszone |
| `einbau/` | `head.html` und `site.webmanifest` mit den Pfaden und Namen dieser Marke |

**Jede Marke trägt den vollständigen Satz** — auch die sechs Module haben eigene
Favicons, iOS- und Android-Symbole sowie ein eigenes Manifest. Damit lässt sich
jedes Modul einzeln als installierbare Anwendung ausliefern, etwa FIDS auf einem
Anzeigebildschirm und Kasse auf einem Verkaufsterminal.

### Warum iOS ohne Ecken, Android mit

iOS legt die Eckenmaske selbst an — ein bereits gerundetes Bild bekommt doppelte
Ecken. Android schneidet je nach Gerät Kreis, Squircle oder Rechteck aus, deshalb
liegen dort zusätzlich `maskable`-Fassungen: voller Farbgrund, Marke auf 40 %
Kantenlänge, damit sie in jeder Maskenform vollständig sichtbar bleibt.

### Warum das Favicon-SVG keine `currentColor` nutzt

Favicons erben keinen Farbkontext vom Dokument. `favicon.svg` bringt deshalb feste
Farben mit eigenem `prefers-color-scheme`-Umschalter mit.

## Einbau

Jede Marke bringt in ihrem `einbau/` einen fertigen Dokumentkopf und ein Manifest
mit — jeweils mit eigenem `name`, `short_name`, `id`, `start_url` und `scope`.
Die Pfade gehen von `/<modul>/` als Wurzel aus und sind bei abweichender
Verzeichnisstruktur anzupassen.

Der Ordner `einbau/` auf oberster Ebene enthält dieselben Dateien für die Hauptmarke.

## Größenschwelle

Ab 24 px trägt die normale Strichstärke. Darunter greift automatisch die kräftigere
Fassung mit 2.0/24, sonst schleiert die Kontur im Pixelraster.

## Farben

| Rolle | Wert |
|---|---|
| Tinte | `#0D1B26` |
| Akzent (Bogen, Knoten) | `#FFB020` |
| Negativ | `#E6EDF3` |

## Neu erzeugen

`generator.py` enthält Geometrie, Glyphen und alle Größenlisten an einer Stelle.
Eine weitere Modul-Marke braucht nur einen zusätzlichen Eintrag in `GLYPHEN`,
`TITEL` und `BASIS` sowie in der Aufzählung am Dateiende.
