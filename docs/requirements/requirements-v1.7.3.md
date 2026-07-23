# Release 1.7.3 – Kontogebundene FIDS-Anzeige

Diese kompatible Ausbaustufe gehört zum Applikationsrelease `1.7.3`. Sie übernimmt Release 1.7.2
sowie die fortgeltenden Kataloge V1.4 bis V1.7.1. Sie ersetzt ausdrücklich die bisherige Pflicht zu
einem Terminalprofil und den anonymen Zugriff auf die FIDS-Webanwendung. Die anonym lesbare
Public-Board-API und die öffentliche Logo-Route bleiben aus Kompatibilitätsgründen bestehen.

| ID | Anforderung | Priorität |
| --- | --- | --- |
| V173-REL-010 | Applikation, Workspace-Pakete, Requirements, Traceability und UI-Konzepte verwenden konsistent Version `1.7.3`. | MUSS |
| V173-FID-010 | Die FIDS-Standardansicht zeigt den Veranstaltungsnamen statt des Produktnamens. Das Veranstaltungslogo wird ohne zusätzlichen Rahmen oder innere Verkleinerung passend zur Titelgröße dargestellt. Der Plane-Fallback steht ebenfalls frei, verwendet die blaue Markenfarbe der Anwendung und besitzt eine schlanke Kontur. Das Terminalprofil entfällt; `/fids/terminal` und `style=terminal` werden kompatibel auf `/fids` normalisiert. | MUSS |
| V173-PRI-010 | Die öffentliche Board-Projektion leitet zuerst den sichtbaren Zustand ab. Alle aktiven Gruppen mit `GO TO GATE` oder `BOARDING` bilden ressourcen- und produktübergreifend einen gemeinsamen obersten Prioritätsblock und behalten darin stabil ihre Queue-Reihenfolge. Pausierte Gruppen gelten als `VERZÖGERT`. | MUSS |
| V173-LAY-010 | Die FIDS-Shell belegt exakt `100dvh` ohne Dokument- oder Tabellen-Scrollbars. Die kontobezogene Zeilenzahl ist standardmäßig 8 und liegt zwischen 4 und 20; sie wird bei ausreichenden Board-Daten exakt eingehalten. Schrift, Zeilen, Kopf, Fuß und Abstände skalieren mit Viewport und Zeilenzahl. Tabellensymbole sind höchstens so hoch wie der zugehörige Text und stehen ohne umgebenden Kreis oder Rahmen. Verwendet werden `users` für Gruppen, `clock-3` für Warten, `circle-arrow-right` für GO TO GATE, `tickets-plane` für BOARDING und `plane-takeoff` für Abgeflogen. WARTEN verwendet die normale Textfarbe; der Trenner der unteren Informationszeile ist neutral und dezent. Das manuelle Zweispaltenlayout wird erst ab 1280 CSS-Pixel aktiv, bleibt darunter gespeichert und verteilt die globale Liste zeilenweise. Schmale Ansichten kombinieren Gruppe und Rundflug in einer Zelle ohne horizontalen Überlauf. | MUSS |
| V173-SET-010 | Ein dezenter Zahnradbutton rechts unten besitzt mindestens ein 44-Pixel-Ziel. Der Dialog verwendet für Bedienelemente die blaue Akzentfarbe der übrigen Anwendung; Statusgelb bleibt semantischen Board-Zuständen vorbehalten. Der Dialog enthält ausschließlich Zeilenzahl, Ein-/Zweispaltenlayout, System/Hell/Dunkel sowie Abmelden, Abbrechen und Speichern. Speichern schließt den Dialog erst nach Serverbestätigung; Fehler und stale Versionskonflikte lassen ihn offen. | MUSS |
| V173-AUT-010 | Die Rolle `DISPLAY` ist in Contract, Login, Kontenverwaltung und Navigation verfügbar. Administratoren können Display-Konten anlegen, deaktivieren, zurücksetzen und deren Sitzungen widerrufen. `/fids` ist mit einer gültigen `DISPLAY`- oder `ADMIN`-Sitzung erreichbar. Display-Konten dürfen server- und clientseitig keine Kassen-, Flight-Line- oder Administrationsansicht verwenden; Kassen-, Flight-Line- und Flight-Director-Konten dürfen FIDS nicht öffnen. Die Startseite für Administratoren bleibt `/admin`. | MUSS |
| V173-SES-010 | Display-Sitzungen besitzen eine absolute Laufzeit von 90 Tagen ohne früheren Idle-Ablauf. Die absolute Laufzeit aller übrigen Rollen bleibt 16 Stunden. Abmeldung, Kontodeaktivierung, PIN-Wechsel und Sitzungswiderruf wirken durch den bestehenden Sitzungsversionsmechanismus sofort. | MUSS |
| V173-API-010 | `FidsPreferences` enthält `visibleRows` 4 bis 20, `layout` `SINGLE`/`DOUBLE`, `theme` `SYSTEM`/`LIGHT`/`DARK` und `version`. GET liefert pro angemeldetem, für FIDS berechtigtem Display- oder Administratorkonto und Veranstaltung den gespeicherten Stand oder `8/SINGLE/SYSTEM` mit Version 0. PUT erwartet `commandId`, `expectedVersion` und die drei Werte; Konto, Sitzung und Gerät stammen ausschließlich aus der authentifizierten Sitzung. Public Board und Logo bleiben anonym lesbar. | MUSS |
| V173-DAT-010 | Genau ein versionierter Präferenzdatensatz wird je `operator_account_id` und `operation_day_id` gespeichert. Aktualisierungen laufen serialisiert und atomar mit Append-only-Audit, Idempotenzbeleg und nicht sensitiver Outbox-Meldung. Stale Writes liefern HTTP 409. Eventlöschung und Werksreset entfernen Präferenzen vor ihren Eltern. | MUSS |
| V173-OPS-010 | Migration 0041 baut den Rollen-Check von `operator_accounts` unter Fremdschlüsselerhalt für `DISPLAY` um und ergänzt `fids_preferences`. Sicherung und Wiederherstellung erfolgen per D1 Time Travel. Portable Backups schließen Präferenzen zusammen mit Konten und Sitzungen bewusst aus. | MUSS |
| V173-AST-010 | In der mobilen Assist-Flugzeugauswahl steht der gesamte aktuelle Zustandsblock aus Symbol und stabil darunterliegender Zustandszeit vertikal mittig zum linken Block der Flugzeugdetails. Der größenstabile Übernahmebutton belegt die gesamte Kartenbreite. Die Markerfläche bleibt unabhängig vom Zustand neutral; nur Symbol und Zeit verwenden die Zustandsfarbe. Die vergrößerten Metadaten nennen Ressourcengruppe und Plätze statt einer unverbindlichen Fluggruppenkennung; eine Ressource wird nur bei vorhandenem Gatewert in einer eigenen Zeile angezeigt. Mobile Historieneinträge verteilen ihre symbolisch beschrifteten Werte auf zwei gleich breite Spalten; Symbole und Werte beginnen in beiden Spalten linksbündig und erzeugen keinen horizontalen Überlauf. Während einer laufenden Flugzeugfreigabe sind Freigabe-, Pilotwechsel- und sämtliche Zustandsaktionen gesperrt. | MUSS |
| V173-QA-010 | Contract-, Domain-, Migrations-, Auth-, Autorisierungs-, Persistenz-, Sortierungs- und UI-Tests sowie Browserabnahmen in Hell/Dunkel/System bei 1920×1080, 1366×768, 1280×720, 1024×768, 800×600 und 430×900 decken 4, 8 und 20 Zeilen, Dialog, Zweispaltenverteilung, Realtime, Offline-Stand und Überlauffreiheit ab. | MUSS |

## Freigegebene UI-Referenzen

- `docs/ui/v1.7.3-fids-standard-approved.png`
- `docs/ui/v1.7.3-fids-settings-approved.png`
- `docs/ui/v1.7.3-fids-double-approved.png`
- `docs/ui/v1.7.3-fids-concept.md`
- `docs/ui/v1.7.3-assist-mobile-concept.md`

Gate- und Veranstaltungsauswahl bleiben URL- beziehungsweise kontextgebunden und sind nicht Teil
des Einstellungsdialogs. Nur fehlende Board-Daten dürfen zu weniger sichtbaren Zeilen als gewählt
führen.
