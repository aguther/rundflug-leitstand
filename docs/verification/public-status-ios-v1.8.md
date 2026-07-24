# Öffentlicher Status und iPhone-Web-Push V1.8

Status: Automatisierte Abnahme erfolgreich; Originalhardware-Abnahme in HTTPS-Staging ausstehend.

## Automatisiert nachgewiesen

- Ticket- und Gruppenstatus verwenden für alle acht API-Zustände dieselben freigegebenen Texte und
  Symbole; PREPARE wird als WARTEN und eine Unterbrechung als VERZÖGERT projiziert.
- GO TO GATE und BOARDING besitzen getrennte Copy.
- Jedes dynamische Manifest enthält den exakten Ticket-/Gruppenpfad als `id` und `start_url`,
  `scope: "/"`, `display: "standalone"`, die Ticketgruppe als Namen und ein Ticket-Icon.
- Ticket-/Gruppenroute, Manifest, Apple-Touch-Icon und Apple-App-Titel werden schon im ersten
  HTML-Dokument verbunden. Kasse, Flight Line, Assist, FIDS und Admin besitzen entsprechend eigene
  Manifeste, Icons und Startpfade.
- Ticket- und Gruppenregistrierungen speichern `target_kind`; Migration 0043 führt Bestände auf
  `GROUP` zurück.
- Push-Nutzlast und Service Worker akzeptieren ausschließlich relative Ticket-/Gruppenpfade.
- Einwilligung, Widerruf, Löschfrist, Apple-Endpunktfreigabe sowie Ausschluss der Push-Tabelle aus
  portablen Backups bleiben getestet.
- Die gerenderte Oberfläche wurde am 23. Juli 2026 mit synthetischen Daten in Hell und Dunkel bei
  390 × 844, 430 × 932 sowie auf dem Desktop geprüft. Nachgewiesen wurden Logo und langer
  Veranstaltungsname, 44-Pixel-Theme-Schalter, fehlender horizontaler Überlauf, unverlinktes
  öffentliches Branding, alle Statusphasen, konkreter Unterbrechungsgrund, Mehrteilgruppe und
  generischer Fehlerzustand. Die Browserkonsole blieb fehlerfrei.
- Der iPhone-Browserzustand wurde per User-Agent-Emulation mit dem exakten deaktivierten Hinweis
  geprüft. Das Geräteschema steuert ohne gespeicherten Wert Hell/Dunkel; eine manuelle Auswahl
  speichert ausschließlich `light` oder `dark`.

## Browser-Bildbelege

- [390 × 844, hell](../ui/v1.8.0-public-status-browser-390x844-light.png)
- [390 × 844, dunkel](../ui/v1.8.0-public-status-browser-390x844-dark.png)
- [430 × 932, hell](../ui/v1.8.0-public-status-browser-430x932-light.png)
- [430 × 932, dunkel](../ui/v1.8.0-public-status-browser-430x932-dark.png)
- [Desktop, hell](../ui/v1.8.0-public-status-browser-desktop-light.png)
- [Desktop, dunkel](../ui/v1.8.0-public-status-browser-desktop-dark.png)

## Verbindliche Originalhardware-Prüfung

Verwendet werden ausschließlich synthetische Codes und die HTTPS-Abnahmeumgebung.

1. Ticket-/Gruppenroute auf einem iPhone im normalen Safari-Tab öffnen. Der Push-Schalter muss
   deaktiviert sein und exakt auf `Zum Home-Bildschirm hinzufügen` verweisen.
2. Über Teilen zum Home-Bildschirm hinzufügen. Titel und Symbol müssen Ticketgruppe und Ticket
   eindeutig erkennen lassen. Das neue Symbol muss ohne Umweg über `/` oder Login exakt dieselbe
   Statusroute im Standalone-Modus öffnen.
3. Benachrichtigungen durch direkte Betätigung des Schalters erlauben.
4. Einen synthetischen Statuswechsel bis GO TO GATE auslösen und den exakten Text
   `Bitte jetzt zum Gate kommen.` in der Benachrichtigung prüfen.
5. Benachrichtigung antippen. Sie muss dieselbe installierte Gruppe öffnen.
6. Einwilligung widerrufen und prüfen, dass keine weitere Zustellung erfolgt.
7. Safari prüfen; Vivaldi zusätzlich prüfen, sofern dessen Teilen-Menü auf dem Testgerät
   `Zum Home-Bildschirm` anbietet.
8. Gerät, iOS-Version, Browser, Uhrzeit, Route und Screenshots protokollieren.
9. Kasse, Flight Line, Assist, FIDS und Admin jeweils separat hinzufügen und prüfen, dass Name,
   Symbol und geöffnete Startansicht dem gewählten Profil entsprechen.

Ein erfolgreicher Desktop-/Emulationstest ersetzt diese Prüfung nicht.
