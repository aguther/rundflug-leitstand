# Öffentlicher Status und iPhone-Web-Push V1.8

Status: Automatisierte Abnahme erfolgreich; Originalhardware-Abnahme in HTTPS-Staging ausstehend.

## Automatisiert nachgewiesen

- Ticket- und Gruppenstatus verwenden für alle acht API-Zustände dieselben freigegebenen
  API-Beschreibungen und Symbole; PREPARE erscheint als BEREITHALTEN, `COME_TO_FLIGHT_LINE` als
  BITTE ZUM GATE und eine Unterbrechung als VERZÖGERT.
- GO TO GATE und BOARDING besitzen getrennte Copy.
- Jedes dynamische Manifest enthält den exakten Ticket-/Gruppenpfad als `id` und `start_url`,
  `scope: "/"`, `display: "standalone"`, die Ticketgruppe als Namen und reguläre sowie maskierbare
  Ticket-Icons.
- Ticket-/Gruppenroute, Manifest, Favicon, Apple-Touch-Icon und Apple-App-Titel werden schon im
  ersten HTML-Dokument verbunden. Kasse, Flight Director, Flight Line, FIDS und Admin besitzen
  entsprechend eigene Manifeste, Icons und Startpfade.
- Der Workbox-Navigationsfallback schließt alle installierbaren Ticket-, Gruppen- und
  Betriebsrouten aus. Damit kann der vorgecachete generische App-Shell weder `Leitstand` noch `/`
  als Installationsprofil unterschieben.
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

## Browser-Nachweis

Die früheren Release-Screenshots wurden nach Übernahme der gültigen Aussagen in den kumulativen
Releasekatalog 1.10.0 entfernt. Der reproduzierbare Nachweis erfolgt über die aktuellen
Browser-Rollenabläufe und die responsiven Public-Status-Tests; das aktuelle Oberflächenkonzept steht
unter [UI-Konzept 1.11.0](../ui/v1.11.0-release-concept.md).

## Verbindliche Originalhardware-Prüfung

Verwendet werden ausschließlich synthetische Codes und die HTTPS-Abnahmeumgebung.

1. Ticket-/Gruppenroute auf einem iPhone im normalen Safari-Tab öffnen. Der Push-Schalter muss
   deaktiviert sein und exakt auf `Zum Home-Bildschirm hinzufügen` verweisen.
2. Über Teilen zum Home-Bildschirm hinzufügen. Titel und Symbol müssen Ticketgruppe und Ticket
   eindeutig erkennen lassen. Das neue Symbol muss ohne Umweg über `/` oder Login exakt dieselbe
   Statusroute im Standalone-Modus öffnen.
3. Benachrichtigungen durch direkte Betätigung des Schalters erlauben.
4. Einen synthetischen Statuswechsel bis BEREITHALTEN auslösen. Der Push muss den Titel
   `Bitte bereithalten`, das konkrete Gate und den Text
   `Ihr Aufruf steht bevor. Bitte halten Sie sich in der Nähe von „<Gate>“ bereit.` zeigen.
5. GO TO GATE auslösen. Der Push muss den Titel `Bitte zum Gate`, das konkrete Gate und den Text
   `Bitte kommen Sie jetzt zu „<Gate>“ und warten Sie dort auf den Boardingaufruf.` zeigen.
6. `CALL_NEXT` bestätigen. Der getrennte Push muss den Titel `Boarding hat begonnen` und den Text
   `Das Boarding an „<Gate>“ hat begonnen. Bitte halten Sie Ihr Ticket für den Einstieg bereit.`
   zeigen.
7. Jede Benachrichtigung antippen. Sie muss dieselbe installierte Ticket- oder Gruppenroute öffnen.
8. Einwilligung widerrufen und prüfen, dass keine weitere Zustellung erfolgt.
9. Safari prüfen; Vivaldi zusätzlich prüfen, sofern dessen Teilen-Menü auf dem Testgerät
   `Zum Home-Bildschirm` anbietet.
10. Gerät, iOS-Version, Browser, Uhrzeit, Route und Screenshots protokollieren.
11. Kasse, Flight Director, Flight Line, FIDS und Admin jeweils separat hinzufügen und prüfen, dass
   Name, Symbol und geöffnete Startansicht dem gewählten Profil entsprechen.

Ein erfolgreicher Desktop-/Emulationstest ersetzt diese Prüfung nicht.
