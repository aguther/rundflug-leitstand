# Öffentliche Monitore im Kioskmodus

Die öffentliche Monitoransicht benötigt keine Gerätekopplung. Veranstaltung, optionales Gate und
Anzeigeprofil werden in der festen Kiosk-URL angegeben:

```text
https://<Worker-Domain>/fids?kiosk=1&event=<Veranstaltungs-ID>
```

Optional werden `gateId=<Gate-ID>` sowie `style=standard` oder `style=terminal` ergänzt. Ein Link
ohne Veranstaltung zeigt ausschließlich einen Einrichtungshinweis. `standard` verwendet
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
- Im FIDS-Kopf wird das in der URL gewählte Gate beziehungsweise die Gesamtansicht erkennbar.
- Eine Teständerung erscheint ohne Neuladen innerhalb von zwei Sekunden.
- Nach einer kurzzeitigen Netzunterbrechung verbindet sich die Ansicht selbständig neu.
- Im Notfallmodus werden keine operativen Gruppeninformationen angezeigt.
- Es sind keine alten Tabs oder Ansichten einer anderen Veranstaltung geöffnet.
- Eine synthetisch als abgeflogen markierte Zeile verschwindet nach der konfigurierten Nachlaufzeit
  aus der Anzeige, bleibt aber in Ticketstatus und Historie erhalten.

Die Ansicht empfängt über WebSocket nur ein minimales Versionssignal. Bei Verbindungsabbruch erfolgt
eine begrenzte, exponentielle Neuverbindung; zusätzlich aktualisiert ein 15-Sekunden-Polling die Anzeige
als Rückfallebene.

Die Standard-Nachlaufzeit für `DEPARTED`/„Abgeflogen“ beträgt 15 Sekunden und ist pro Veranstaltung
zwischen 5 und 900 Sekunden konfigurierbar. Für eine administrative Vorschau kann `departedSeconds`
in der URL gesetzt werden. Ein vorübergehender Server- oder D1-Fehler leert die Anzeige nicht; der
letzte bestätigte Stand bleibt mit sichtbarem Verbindungsstatus erhalten.
