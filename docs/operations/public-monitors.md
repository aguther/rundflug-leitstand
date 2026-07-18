# Öffentliche Monitore im Kioskmodus

Die öffentliche Monitoransicht wird im Regelbetrieb über einen administrativ erzeugten
Display-Kopplungs-QR-Code eingerichtet. Die Kopplung speichert Veranstaltung, optionales Gate und
Anzeigeprofil gemeinsam auf dem vorgesehenen Gerät. Danach genügt folgende feste Kiosk-URL:

```text
https://<Worker-Domain>/fids?kiosk=1
```

Für Vorschau und kontrollierte manuelle Installation können die gebundenen Werte auch über
`event=<Veranstaltungs-ID>`, `gateId=<Gate-ID>` sowie `style=standard` oder `style=terminal`
angegeben werden. Ein Link ohne Veranstaltung und ohne vorhandene Kopplung zeigt ausschließlich
einen Einrichtungshinweis. `standard` verwendet
deutsche Begriffe. `terminal` verwendet ausschließlich englische beschreibende Begriffe wie
`DEPARTURES`, `WAITING`, `GO TO GATE`, `BOARDING`, `DELAYED` und `DEPARTED`.

`kiosk=1` blendet Navigation und Fußbereich aus. Die Ansicht zeigt ausschließlich Produkte,
abgeleitete Ticket-/Fluggruppenkennungen, Gates, Zustände, zugeordnete Flugzeuge, Zeitfenster und den
Flottenstatus. Private QR-Codes, Pilotencodes, Gerätekennungen und interne IDs werden nicht an die
Monitoransicht übertragen.

## Einrichtung des Abspielgeräts

Das Betriebssystem oder die Geräteverwaltung startet nach dem Einschalten einen aktuellen Browser mit
der obigen URL im Vollbild-/Kioskmodus. Ruhezustand und Bildschirmschoner sind für den Veranstaltungstag
zu deaktivieren. Diese Gerätekonfiguration erfolgt lokal am Abspielgerät und benötigt keine zusätzliche
Cloudflare-Konfiguration.

Vor Veranstaltungsbeginn ist zu prüfen:

- Browser und Monitor starten ohne Benutzereingriff und öffnen die richtige Veranstaltung.
- Im FIDS-Kopf wird das bei der Kopplung gewählte Gate beziehungsweise die Gesamtansicht erkennbar.
- Eine Teständerung erscheint ohne Neuladen innerhalb von zwei Sekunden.
- Nach einer kurzzeitigen Netzunterbrechung verbindet sich die Ansicht selbständig neu.
- Im Notfallmodus werden keine operativen Gruppeninformationen angezeigt.
- Es sind keine alten Tabs oder Ansichten einer anderen Veranstaltung geöffnet.
- Eine synthetisch als abgeflogen markierte Zeile verschwindet nach der konfigurierten Nachlaufzeit
  aus der Anzeige, bleibt aber in Ticketstatus und Historie erhalten.

Die Ansicht empfängt über WebSocket nur ein minimales Versionssignal. Bei Verbindungsabbruch erfolgt
eine begrenzte, exponentielle Neuverbindung; zusätzlich aktualisiert ein 15-Sekunden-Polling die Anzeige
als Rückfallebene.

Die Standard-Nachlaufzeit für `DEPARTED`/„Abgeflogen“ beträgt fünf Minuten und ist pro Display
zwischen einer und 15 Minuten konfigurierbar. Ein vorübergehender Server- oder D1-Fehler leert die
Anzeige nicht; der letzte bestätigte Stand bleibt mit sichtbarem Verbindungsstatus erhalten.
