#!/usr/bin/env python3
"""
Rundflug Leitstand — Icon-Set-Generator.

Alles entsteht aus einer einzigen Geometrie-Definition:
48er-Raster (= 2x Lucide), Strichstaerke 2.4 (= 1.2/24).
"""
import os, shutil
from pathlib import Path
import cairosvg

AUS = str(Path(__file__).resolve().parent)

# ---------------------------------------------------------------- Farben
TINTE  = "#0D1B26"
AMBER  = "#FFB020"
HELL   = "#E6EDF3"
NACHT  = "#0D1B26"

# ------------------------------------------------------------- Geometrie
BOGEN   = 'M32.54 4.82A21 21 0 1 0 43.18 15.46'
SW_RING = 2.4      # Bogen im 48er-Raster
SW_GLYF = 2.0      # innen, bei Faktor 1.2 -> gerendert ebenfalls 2.4
KNOTEN  = 2.24
# Optische statt mathematischer Groesse: das flache plane-takeoff vertraegt 1.2,
# die kompakten Modul-Glyphen wirken bei gleichem Faktor deutlich groesser.
GLYF_SKALA = {"marke": 1.2}
GLYF_STANDARD = 1.1


def glyf_transform(schluessel):
    f = GLYF_SKALA.get(schluessel, GLYF_STANDARD)
    rand = 24 - 12 * f
    return f'translate({rand:.4f} {rand:.4f}) scale({f})', f

# Kleine optische Fassung (< 24 px)
SW_RING_K, SW_GLYF_K, KNOTEN_K = 4.0, 3.3333, 3.4

# ------------------------------------------ Lucide-Glyphen (24er-Raster)
GLYPHEN = {
    # plane-takeoff, Bodenlinie auf 18 Einheiten gekuerzt (einzige Abweichung vom Original)
    "marke": (
        '<path d="M3 22h18"/>'
        '<path d="M6.36 17.4 4 17l-2-4 1.1-.55a2 2 0 0 1 1.8 0l.17.1a2 2 0 0 0 1.8 0L8 12 5 6l.9-.45'
        'a2 2 0 0 1 2.09.2l4.02 3a2 2 0 0 0 2.1.2l4.19-2.06a2.41 2.41 0 0 1 1.73-.17L21 7'
        'a1.4 1.4 0 0 1 .87 1.99l-.38.76c-.23.46-.6.84-1.07 1.08L7.58 17.2a2 2 0 0 1-1.22.18Z"/>'
    ),
    # tickets — Ausgabesystem, also der Stapel
    "kasse": (
        '<path d="m3.173 8.18 11-5a2 2 0 0 1 2.647.993L18.56 8"/>'
        '<path d="M6 10V8"/>'
        '<path d="M6 14v1"/>'
        '<path d="M6 19v2"/>'
        '<rect x="2" y="8" width="20" height="13" rx="2"/>'
    ),
    # users
    "flight-director": (
        '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>'
        '<path d="M16 3.128a4 4 0 0 1 0 7.744"/>'
        '<path d="M22 21v-2a4 4 0 0 0-3-3.87"/>'
        '<circle cx="9" cy="7" r="4"/>'
    ),
    # headphones
    "flight-line": (
        '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7'
        'a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>'
    ),
    # monitor
    "fids": (
        '<rect width="20" height="14" x="2" y="3" rx="2"/>'
        '<line x1="8" x2="16" y1="21" y2="21"/>'
        '<line x1="12" x2="12" y1="17" y2="21"/>'
    ),
    # settings
    "administration": (
        '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915'
        ' 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033'
        ' 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915'
        ' 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051'
        'a2.34 2.34 0 0 0 3.319-1.915"/>'
        '<circle cx="12" cy="12" r="3"/>'
    ),
    # ticket — das einzelne Dokument
    "ticket": (
        '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7'
        'a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/>'
        '<path d="M13 5v2"/><path d="M13 11v2"/><path d="M13 17v2"/>'
    ),
}

TITEL = {
    "marke":            "Rundflug Leitstand",
    "kasse":            "Kasse",
    "flight-director":  "Flight Director",
    "flight-line":      "Flight Line",
    "fids":             "FIDS",
    "ticket":           "Ticket",
    "administration":   "Administration",
}

BASIS = {
    "marke":            "plane-takeoff",
    "kasse":            "tickets",
    "flight-director":  "users",
    "flight-line":      "headphones",
    "fids":             "monitor",
    "ticket":           "ticket",
    "administration":   "settings",
}


# ------------------------------------------------------------- Bausteine
def marke_inhalt(schluessel, strich, akzent, ring_sw, glyf_sw, knoten_r):
    """Bogen + Knoten + Glyphe, ohne umgebendes svg-Element."""
    tf, faktor = glyf_transform(schluessel)
    glyf_sw = round(ring_sw / faktor, 4)   # gerendert immer gleich stark wie der Bogen
    return (
        f'<path d="{BOGEN}" fill="none" stroke="{akzent}" stroke-width="{ring_sw}" '
        f'stroke-linecap="round" stroke-linejoin="round"/>'
        f'<g transform="{tf}" fill="none" stroke="{strich}" stroke-width="{glyf_sw}" '
        f'stroke-linecap="round" stroke-linejoin="round">{GLYPHEN[schluessel]}</g>'
        f'<circle cx="38.85" cy="9.15" r="{knoten_r}" fill="{akzent}"/>'
    )


def svg_marke(schluessel, strich=TINTE, akzent=AMBER, klein=False, groesse=48):
    r, g, k = ((SW_RING_K, SW_GLYF_K, KNOTEN_K) if klein
               else (SW_RING, SW_GLYF, KNOTEN))
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{groesse}" height="{groesse}" '
        f'viewBox="0 0 48 48" role="img" aria-label="{TITEL[schluessel]}">\n  '
        + marke_inhalt(schluessel, strich, akzent, r, g, k)
        + '\n</svg>\n'
    )


def svg_app(schluessel, kante=512, radius=114, grund=NACHT,
            strich=HELL, akzent=AMBER, anteil=0.585):
    """App-Symbol: Marke negativ auf abgerundetem Grund."""
    breite = kante * anteil
    faktor = breite / 48
    rand = (kante - breite) / 2
    ecke = f'<rect width="{kante}" height="{kante}" rx="{radius}" fill="{grund}"/>' if radius \
        else f'<rect width="{kante}" height="{kante}" fill="{grund}"/>'
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{kante}" height="{kante}" '
        f'viewBox="0 0 {kante} {kante}" role="img" aria-label="{TITEL[schluessel]}">\n'
        f'  {ecke}\n'
        f'  <g transform="translate({rand:.4f} {rand:.4f}) scale({faktor:.6f})">'
        + marke_inhalt(schluessel, strich, akzent, SW_RING, SW_GLYF, KNOTEN)
        + '</g>\n</svg>\n'
    )


def png(svg_text, ziel, kante):
    os.makedirs(os.path.dirname(ziel), exist_ok=True)
    cairosvg.svg2png(bytestring=svg_text.encode("utf-8"),
                     write_to=ziel, output_width=kante, output_height=kante)


def schreib(pfad, text):
    os.makedirs(os.path.dirname(pfad), exist_ok=True)
    with open(pfad, "w", encoding="utf-8") as f:
        f.write(text)


# ------------------------------------------------------------- Groessen
GR_ICON     = [16, 24, 32, 48, 64, 128, 256, 512]
GR_FAVICON  = [16, 32, 48, 96]
GR_IOS      = [120, 152, 167, 180, 1024]
GR_ANDROID  = [48, 72, 96, 144, 192, 512]
GR_MASKABLE = [192, 512]


def baue(schluessel, wurzel):
    os.makedirs(wurzel, exist_ok=True)

    # ---------- SVG ----------
    schreib(f"{wurzel}/svg/icon.svg",
            svg_marke(schluessel, strich="currentColor", akzent="currentColor"))
    schreib(f"{wurzel}/svg/icon-zweifarbig.svg", svg_marke(schluessel))
    schreib(f"{wurzel}/svg/icon-negativ.svg", svg_marke(schluessel, strich=HELL))
    schreib(f"{wurzel}/svg/icon-klein.svg",
            svg_marke(schluessel, strich="currentColor", akzent="currentColor", klein=True))
    schreib(f"{wurzel}/svg/app-icon.svg", svg_app(schluessel))
    schreib(f"{wurzel}/svg/app-icon-maskable.svg",
            svg_app(schluessel, radius=0, anteil=0.40))
    schreib(f"{wurzel}/svg/favicon.svg", favicon_svg(schluessel))

    # ---------- Icon-PNG, hell- und dunkelgrundig ----------
    for ton, farbe in (("dunkelgrund", HELL), ("hellgrund", TINTE)):
        for s in GR_ICON:
            quelle = svg_marke(schluessel, strich=farbe, klein=(s < 24))
            png(quelle, f"{wurzel}/png-icon/{ton}/icon-{s}.png", s)

    # ---------- Favicon ----------
    for s in GR_FAVICON:
        png(svg_marke(schluessel, strich=TINTE, klein=(s < 32)),
            f"{wurzel}/favicon/favicon-{s}.png", s)
    png(svg_app(schluessel, kante=180, radius=0), f"{wurzel}/favicon/apple-touch-icon-180.png", 180)
    ico(schluessel, f"{wurzel}/favicon/favicon.ico")

    # ---------- iOS: deckend, ohne Eckenrundung (Maske kommt vom System) ----------
    for s in GR_IOS:
        png(svg_app(schluessel, kante=1024, radius=0), f"{wurzel}/app-ios/icon-{s}.png", s)

    # ---------- Android ----------
    for s in GR_ANDROID:
        png(svg_app(schluessel, kante=1024, radius=180), f"{wurzel}/app-android/icon-{s}.png", s)
    for s in GR_MASKABLE:
        png(svg_app(schluessel, kante=1024, radius=0, anteil=0.40),
            f"{wurzel}/app-android/maskable-{s}.png", s)

    einbau(schluessel, wurzel)


def einbau(schluessel, wurzel):
    """Kopfverweise und Web-App-Manifest je Marke — Module lassen sich
    dadurch einzeln auf einem Geraet installieren."""
    pfad = "/" if schluessel == "marke" else f"/{schluessel}/"
    name = ("Rundflug Leitstand" if schluessel == "marke"
            else f"Rundflug Leitstand \u2014 {TITEL[schluessel]}")
    kurz = "Leitstand" if schluessel == "marke" else TITEL[schluessel]

    schreib(f"{wurzel}/einbau/head.html",
        f"""<!-- {name} -->
<link rel="icon" href="{pfad}favicon.ico" sizes="32x32">
<link rel="icon" href="{pfad}icons/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="{pfad}icons/apple-touch-icon-180.png">
<link rel="manifest" href="{pfad}site.webmanifest">
<meta name="theme-color" content="{NACHT}">
""")

    schreib(f"{wurzel}/einbau/site.webmanifest",
        f"""{{
  "name": "{name}",
  "short_name": "{kurz}",
  "id": "{pfad}",
  "start_url": "{pfad}",
  "scope": "{pfad}",
  "background_color": "{NACHT}",
  "theme_color": "{NACHT}",
  "display": "standalone",
  "icons": [
    {{ "src": "{pfad}icons/android/icon-192.png",     "sizes": "192x192", "type": "image/png" }},
    {{ "src": "{pfad}icons/android/icon-512.png",     "sizes": "512x512", "type": "image/png" }},
    {{ "src": "{pfad}icons/android/maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" }},
    {{ "src": "{pfad}icons/android/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }}
  ]
}}
""")


def favicon_svg(schluessel):
    """Feste Farben plus eigener Hell-/Dunkel-Umschalter — Favicons erben keinen Farbkontext."""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 48 48" '
        f'role="img" aria-label="{TITEL[schluessel]}">\n'
        f'  <style>.t{{stroke:{TINTE}}}'
        f'@media (prefers-color-scheme: dark){{.t{{stroke:{HELL}}}}}</style>\n'
        f'  <path d="{BOGEN}" fill="none" stroke="{AMBER}" stroke-width="{SW_RING_K}" '
        f'stroke-linecap="round" stroke-linejoin="round"/>\n'
        f'  <g class="t" transform="{glyf_transform(schluessel)[0]}" fill="none" '
        f'stroke-width="{round(SW_RING_K / glyf_transform(schluessel)[1], 4)}" '
        f'stroke-linecap="round" stroke-linejoin="round">{GLYPHEN[schluessel]}</g>\n'
        f'  <circle cx="38.85" cy="9.15" r="{KNOTEN_K}" fill="{AMBER}"/>\n</svg>\n'
    )


def ico(schluessel, ziel):
    """Mehrgroessen-ICO fuer aeltere Browser."""
    from PIL import Image
    import io
    bilder = []
    for s in (16, 32, 48):
        roh = cairosvg.svg2png(
            bytestring=svg_marke(schluessel, strich=TINTE, klein=(s < 32)).encode("utf-8"),
            output_width=s, output_height=s)
        bilder.append(Image.open(io.BytesIO(roh)).convert("RGBA"))
    os.makedirs(os.path.dirname(ziel), exist_ok=True)
    bilder[0].save(ziel, format="ICO",
                   sizes=[(b.width, b.height) for b in bilder],
                   append_images=bilder[1:])


# ------------------------------------------------------------------ Lauf
if __name__ == "__main__":
    for zweig in (f"{AUS}/marke", f"{AUS}/module"):
        if os.path.isdir(zweig):
            shutil.rmtree(zweig)
    baue("marke", f"{AUS}/marke")
    for s in ("kasse", "flight-director", "flight-line", "fids", "ticket", "administration"):
        baue(s, f"{AUS}/module/{s}")

    zeilen = ["# Inventar", "",
              "Automatisch erzeugt von `generator.py`.", ""]
    for wurzel in [f"{AUS}/marke"] + [f"{AUS}/module/{k}" for k in
                   ("kasse", "flight-director", "flight-line", "fids", "ticket",
                    "administration")]:
        k = os.path.basename(wurzel)
        zeilen += [f"## {TITEL[k]} \u2014 `{os.path.relpath(wurzel, AUS)}/`",
                   "", f"Glyphe: `{BASIS[k]}`", ""]
        for ordner, _, dateien in sorted(os.walk(wurzel)):
            if not dateien:
                continue
            rel = os.path.relpath(ordner, wurzel)
            zeilen.append(f"- `{rel}/` \u2014 " + ", ".join(f"`{d}`" for d in sorted(dateien)))
        zeilen.append("")
    schreib(f"{AUS}/INVENTAR.md", "\n".join(zeilen))

    anzahl = sum(len(d) for _, _, d in os.walk(AUS))
    print(f"{anzahl} Dateien erzeugt")
