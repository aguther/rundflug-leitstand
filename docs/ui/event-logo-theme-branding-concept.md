# UI-Konzept: Themevarianten und Rundflug-Leitstand-Fallback

- Status: freigegeben
- Datum: 2026-07-25
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: V15-BRAND-010, V173-FID-010, V19-BRN-010

## Administration

Die Veranstaltungseinstellungen zeigen zwei gleichwertige Uploadbereiche für das helle und dunkle
Theme. Jeder Bereich besitzt eine Vorschau auf der passenden neutralen Hintergrundfläche,
Dateiauswahl, Upload und Entfernen. Die Vorschau darf die Gegenvariante zeigen, kennzeichnet dann
aber, dass keine eigene Datei hinterlegt ist. Auf schmalen Ansichten stehen die Bereiche
untereinander. Zulässig bleiben PNG, JPEG, WebP und sicheres SVG bis 1 MiB.

## Anzeige

Allgemeine Ansichten wählen die Logo-URL anhand des tatsächlich aufgelösten Anwendungsthemes.
Das FIDS verwendet unabhängig davon seine Einstellung `LIGHT`, `DARK` oder das aufgelöste
`SYSTEM`-Theme. Fehlt die angeforderte Variante, liefert der Server die Gegenvariante.

Ohne beide Veranstaltungslogos zeigt das System die neue Marke aus Rundkurs, Knoten und
Plane-Takeoff. Neben einem vorhandenen Veranstaltungs- oder Seitentitel bleibt sie quadratisch.
Statische Produkt-Topbars von Login und Veranstaltungsauswahl zeigen den horizontalen Lockup mit
zweizeiliger Wortmarke und entfernen die bisherige redundante Textwiederholung.

## Gestaltung und Barrierefreiheit

Die Marke verwendet im hellen Theme Tinte `#0D1B26`, im dunklen Theme `#E6EDF3` und für Rundkurs
und Knoten `#FFB020`. Barlow Condensed 200/400 wird lokal aus der PWA geladen. Kompakte Marken sind
bei sichtbarem Nachbartitel dekorativ; der vollständige Lockup besitzt genau den zugänglichen Namen
„Rundflug Leitstand“. Generische und ansichtsspezifische PWA-Icons bleiben unverändert.
