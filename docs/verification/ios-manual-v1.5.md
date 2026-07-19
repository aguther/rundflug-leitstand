# Manuelle iPhone-/iPad-Abnahme V1.5

Automatisierte responsive Browserprüfungen ersetzen diese Prüfung auf echter Apple-Hardware nicht.

## Geräte und Vorbereitung

- ein aktuelles iPhone und ein iPad oder iPad mini;
- jeweils aktuelle und vorherige unterstützte Safari-/iOS-Hauptversion, soweit verfügbar;
- Test im normalen Safari-Tab und als zum Home-Bildschirm hinzugefügte PWA;
- synthetische Testveranstaltung, mindestens zwei Produkte, drei Gruppen und zwei Flugzeuge.

## Prüffolge

1. Anmeldung, Veranstaltungsauswahl und Wechsel zwischen allen berechtigten Ansichten durchführen.
2. Gerät drehen, Split View auf dem iPad verwenden und prüfen, dass keine Primäraktion außerhalb des
   Viewports liegt.
3. Flight Line Assist auf dem iPhone einspaltig und auf iPad zweispaltig bedienen: Claim,
   Gruppenanwesenheit ohne Scan, Kombination, Boarding, Off-Block, On-Block, Abschluss.
4. Kamera-Scan erlauben und verweigern; die manuelle Anwesenheit muss in beiden Fällen funktionieren.
5. PWA in den Hintergrund schicken, wieder öffnen und Reconnect sowie aktuellen Serverstand prüfen.
6. Hell/Dunkel, 200-%-Textvergrößerung, Touchziele, Safe Areas, Bildschirmtastatur und Scrollsperren
   prüfen.
7. Ticketzettel anzeigen, QR-Code mit einem zweiten Gerät scannen und Nachdruck aus der Suche testen.
8. Offline/Online-Wechsel durchführen; der letzte bestätigte Stand bleibt sichtbar und wird nach
   Reconnect abgeglichen.
9. In den Safari-Webinformationen prüfen, dass Betriebsrequests nur das HttpOnly-Sitzungscookie und
   keine `x-device-id`-/`x-device-token`-Header verwenden. Einen simulierten fehlgeschlagenen
   Operations-GET über den GET-only-XHR-Fallback wiederholen; Schreibaktionen dürfen nicht
   automatisch wiederholt werden.
10. Einen verbreiteten Inhalts-/Tracking-Blocker aktivieren und Anmeldung, Veranstaltungsauswahl,
    initialen Betriebsstand, manuellen Refresh, eine synthetische Schreibaktion sowie Reconnect
    wiederholen. Geschützte Betriebsrequests und der operative WebSocket müssen ausschließlich unter
    `/api/control/:eventId/...` laufen; öffentliche FIDS- und Ticketpfade bleiben unter
    `/api/public/...`.

Abweichungen werden mit Gerät, iOS-Version, Route, Orientierung, reproduzierbaren Schritten und
Screenshot dokumentiert.
