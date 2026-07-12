# Öffentliche Monitore im Kioskmodus

Die öffentliche Monitoransicht wird mit folgender URL gestartet:

```text
https://<Worker-Domain>/fids?kiosk=1&event=<Veranstaltungs-ID>
```

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
- Eine Teständerung erscheint ohne Neuladen innerhalb von zwei Sekunden.
- Nach einer kurzzeitigen Netzunterbrechung verbindet sich die Ansicht selbständig neu.
- Im Notfallmodus werden keine operativen Gruppeninformationen angezeigt.
- Es sind keine alten Tabs oder Ansichten einer anderen Veranstaltung geöffnet.

Die Ansicht empfängt über WebSocket nur ein minimales Versionssignal. Bei Verbindungsabbruch erfolgt
eine begrenzte, exponentielle Neuverbindung; zusätzlich aktualisiert ein 15-Sekunden-Polling die Anzeige
als Rückfallebene.
