# Bedienkonzept Produkt- und Stammdatenpflege V1

Status: **am 14.07.2026 fachlich und visuell freigegeben und umgesetzt**

Betroffene Anforderungen: F-RES-010, F-RES-020, F-RES-060, F-KAS-030, F-KAS-110,
Q-UX-010, Q-UX-020 und Q-UX-040.

## Befund

Die aktuelle Produktmaske bildet den technischen Vertrag zu direkt ab:

- Der Preis wird in Cent statt als üblicher Eurobetrag eingegeben.
- `sortOrder` erscheint ohne fachliche Erklärung als „Sortierung“.
- Die internen Gewichtscodes `NOT_CAPTURED`, `CHILD`, `NORMAL`, `HEAVY` und `INDIVIDUAL`
  werden unverändert angezeigt. `NOT_CAPTURED` ist fachlich keine gleichzeitig auswählbare
  Gewichtsklasse, sondern der ausgeschaltete Zustand der gesamten Gewichtserfassung.
- Wird keine Gewichtsklasse gewählt, verhindert die Oberfläche das Speichern, nennt diesen Grund
  aber nicht in der Validierung. Dadurch wirkt die Produktanlage funktionslos.
- Die PIN-Bestätigung ist weder als Formular mit Enter-Aktion umgesetzt noch erhält das PIN-Feld
  automatisch den Fokus.
- Der Worker-/D1-Speicherweg funktioniert nachweislich; der Integrationstest deckt Anlage,
  Änderung, Audit, ungültige Referenzen, doppelte Kürzel und stale writes ab. Der gemeldete
  Bedienfehler liegt damit in der aktuellen Oberfläche und ihrer unklaren Validierung.

## Zielbild

Die Stammdatenpflege bleibt eine kompakte Liste mit seitlichem Editor auf Desktop und Bottom-Sheet
auf Mobilgeräten. Der Editor zeigt ausschließlich fachliche Begriffe. Jedes Eingabefeld besitzt
direkt neben seiner Bezeichnung eine kleine Info-Aktion `i`. Sie öffnet per Klick, Tastatur oder
Touch einen kurzen Erklärungstext; auf Desktop ist derselbe Text zusätzlich beim Darüberfahren
verfügbar. Die Hilfe darf nie Voraussetzung für die Bedienung sein.

```text
Produkt anlegen                                      [×]

Allgemein
Bezeichnung                         (i)
[ 20 Minuten Panorama                    ]

Kürzel                             (i)   Preis in €                  (i)
[ PAN20                                ]   [ 45,00 €                       ]

Öffentliche Beschreibung          (i)
[ Panoramaflug über die Region ...                                  ]

Planung
Ressourcengruppe                  (i)   Gate                        (i)
[ Panorama                      ▾ ]     [ Eingang Halle           ▾ ]

Referenzplätze                    (i)   Referenzdauer               (i)
[ 4                              ]      [ 20 Minuten                 ]

Position in Anzeigen              (i)
[ Nach „Kurzflug“               ▾ ]

Angaben beim Verkauf
(•) Keine Gewichtserfassung       (i)
( ) Gewichtsklassen erfassen
    [ ] Kind  [ ] Standard  [ ] Schwer  [ ] Individuelles Gewicht

[ ] Bei Kindern auf erforderliche Begleitung hinweisen              (i)

                                           [Abbrechen] [Produkt speichern]
```

## Feldverhalten

### Preis

- Beschriftung: `Preis in €`.
- Eingabe und Anzeige im deutschen Format, zum Beispiel `45,00 €`.
- Akzeptiert Komma oder Punkt als Dezimaltrenner, maximal zwei Nachkommastellen.
- Erst an der API-Grenze wird exakt und ohne Gleitkommafehler in Cent umgerechnet.
- Hilfetext: „Informatorischer Einzelpreis je Ticket. Das System ist keine elektronische Kasse.“

### Position in Anzeigen

- Der technische Zahlenwert wird nicht mehr direkt eingegeben.
- Auswahl über eine fachliche Position: `Ganz vorne`, `Nach <Produkt>` oder `Ganz hinten`.
- In Tabellen kann die Reihenfolge zusätzlich mit kompakten Pfeilaktionen geändert werden.
- Hilfetext: „Legt nur die Reihenfolge in Kasse und Anzeigen fest. Queue und Priorität ändern sich
  dadurch nicht.“

### Gewichtserfassung

- Standard ist `Keine Gewichtserfassung`; intern entspricht dies ausschließlich
  `NOT_CAPTURED`.
- Bei `Gewichtsklassen erfassen` werden die fachlichen Optionen `Kind`, `Standard`, `Schwer` und
  `Individuelles Gewicht` eingeblendet. Mindestens eine Klasse ist erforderlich.
- `NOT_CAPTURED` kann nie gemeinsam mit einer Gewichtsklasse gespeichert werden.
- Der Begleithinweis für Kinder ist nur auswählbar, wenn `Kind` aktiv ist. Andernfalls ist er
  deaktiviert und erklärt sichtbar den Grund.
- Hilfetext Gewichtsklassen: „Aktivierte Klassen werden an der Kasse je anonymem Ticket abgefragt.
  Es werden keine Namen erfasst.“
- Hilfetext Begleithinweis: „Zeigt bei einer Kinderbuchung ohne passende Begleitung einen
  organisatorischen Hinweis. Dies ist keine flugbetriebliche Freigabe.“

### Übrige Felder

- Bezeichnung: interner und öffentlicher Produktname.
- Kürzel: 2–12 Großbuchstaben, Ziffern oder Bindestriche; Bestandteil der stabilen
  Fluggruppenkennung.
- Öffentliche Beschreibung: kurzer Text für Kasse und öffentliche Anzeigen.
- Ressourcengruppe: genau eine gemeinsame operative Queue und Kapazität.
- Gate: veröffentlichter Treffpunkt beziehungsweise Abfertigungsort.
- Referenzplätze: Ausgangswert für die anfängliche Gruppenbildung; die konkrete
  Flugzeugkapazität bleibt maßgeblich.
- Referenzdauer: Planwert für den Kaltstart der Prognose, keine zugesagte Flugzeit.

Die gleiche `i`-Komponente wird in allen Stammdaten-Editoren verwendet. Texte sind feldspezifisch,
maximal zwei kurze Sätze lang und vollständig per Tastatur sowie Screenreader erreichbar.

## Validierung und Speichern

- Pflichtfehler erscheinen direkt am betroffenen Feld, nicht nur als Sammelmeldung.
- Der Speichern-Button bleibt grundsätzlich erreichbar. Beim Auslösen springt der Fokus zum ersten
  fehlerhaften Feld und nennt den konkreten Grund.
- Der Worker liefert fachliche Fehler wie doppeltes Kürzel oder ungültiges Gate einem konkreten Feld
  zugeordnet zurück.
- Ein erfolgreicher Speichervorgang schließt den Editor, aktualisiert die Liste und zeigt eine kurze
  Bestätigung mit dem Produktnamen.
- Der Integrationstest weist Anlage, Änderung, Audit, stale write, ungültige Referenz, doppeltes
  Kürzel und widersprüchliche Gewichtskonfigurationen nach; die allgemeine Kommando-Pipeline deckt
  zusätzlich Idempotenz ab.

## Admin-Bearbeitungsmodus

Die Administration bietet oben eine klar erkennbare Aktion `Bearbeitungsmodus entsperren`.

### Standardmodus

- Stammdaten können vorbereitet werden.
- Beim Speichern jeder einzelnen Änderung öffnet sich die bestehende PIN-Bestätigung.
- Das PIN-Feld erhält beim Öffnen automatisch den Fokus.
- Die Bestätigung ist ein echtes Formular: `Enter` bestätigt, `Escape` bricht ab.

### Entsperrter Bearbeitungsmodus

- `Bearbeitungsmodus entsperren` öffnet eine fokussierte PIN-Abfrage.
- Die PIN wird vor dem Entsperren serverseitig geprüft.
- Nach erfolgreicher Prüfung zeigt die Kopfzeile gut sichtbar
  `Bearbeitungsmodus aktiv · sperren`.
- Mehrere Änderungen können gespeichert werden, ohne die PIN erneut einzugeben. Jede Änderung
  bleibt ein eigenes autorisiertes, versioniertes und auditiertes Kommando.
- Die PIN liegt ausschließlich im Arbeitsspeicher des aktuellen Browser-Tabs. Sie wird weder in
  Local Storage, Session Storage, IndexedDB, URL noch Logs geschrieben.
- `Bearbeitungsmodus sperren`, Neuladen, Rollenverlust oder 15 Minuten Inaktivität löschen die PIN
  sofort. Danach gilt wieder die Einzelabfrage des Standardmodus.
- Vor Löschungen und Werkszustand bleibt unabhängig vom Modus eine eigene ausdrückliche
  Bestätigung erforderlich.

## Responsive und Theme

- Desktop: rechter Editor mit maximal 520 Pixel Breite; Feldgruppen in ruhigen Abschnitten.
- Mobil: Bottom-Sheet mit fixierter Titel- und Aktionszeile; keine horizontale Scrollfläche.
- Info-Popover bleiben innerhalb des Viewports und sind im Dark Theme nicht heller als die übrigen
  Oberflächen.
- Alle Texte, Placeholder, Fehler, deaktivierten Zustände und Fokusrahmen erfüllen mindestens
  WCAG-AA-Kontrast.

## Abnahme

1. Ein neues Produkt lässt sich mit Eurobetrag und ohne Gewichtserfassung vollständig anlegen.
2. Ein Produkt mit Gewichtsklassen lässt sich nur mit mindestens einer fachlichen Klasse speichern.
3. Der Begleithinweis wird nur zusammen mit `Kind` angeboten.
4. Anzeige-Reihenfolge und Queue-Priorität werden verständlich voneinander abgegrenzt.
5. Jedes Feld besitzt eine per Maus, Touch, Tastatur und Screenreader nutzbare Erklärung.
6. Die Einzel-PIN-Abfrage fokussiert automatisch und bestätigt mit Enter.
7. Im entsperrten Modus sind mehrere Änderungen ohne erneute Eingabe möglich; Sperren oder
   Inaktivität stellt die Einzelabfrage wieder her.
8. Anlage und Änderung sind in Light/Dark bei 430, 768 und 1440 Pixel ohne Überlauf lesbar.

## Umsetzungs- und Prüfnachweis

Die freigegebene Oberfläche ist in der Administration umgesetzt. Die Prüfung am 14.07.2026
umfasste den realen lokalen Worker-/D1-Pfad sowie die Darstellung bei 430 und 1440 Pixel Breite in
Light und Dark. Dabei wurden insbesondere folgende Abläufe nachgewiesen:

- Produktanlage mit deutschem Eurobetrag und exakter Umrechnung in Cent an der API-Grenze,
- verständliche Anzeigenposition statt technischer Sortierzahl,
- ausschließliche Auswahl zwischen keiner Gewichtserfassung und fachlichen Gewichtsklassen,
- Kopplung des Begleithinweises an die Gewichtsklasse `Kind`,
- feldbezogene, per Tastatur erreichbare Info-Aktionen und Validierung,
- fokussierte Einzel-PIN-Abfrage mit Enter-Bestätigung und Escape-Abbruch,
- mehrere Änderungen im entsperrten Bearbeitungsmodus sowie manuelles Sperren,
- kein horizontaler Überlauf des Editors auf Mobil- und Desktopbreite.

Die PIN wird im Bearbeitungsmodus nur im Arbeitsspeicher des aktuellen Tabs gehalten. Der neue
Prüfendpunkt verlangt zusätzlich ein bereits gekoppeltes Administrationsgerät, setzt
`Cache-Control: no-store` und erzeugt weder eine persistente Sitzung noch einen Audit-Eintrag ohne
fachliche Änderung.
