# POS-58-Direktdruck

## Zweck und Grenze

Die Kassen-PWA verwendet `window.print()`. In einem normalen Browser öffnet dieser Webstandard den
Druckdialog. Die Anwendung speichert weder Druckernamen noch Betriebssystemberechtigungen und
umgeht keine Browser-Sicherheitsabfrage.

Auf einem fest verwalteten Kassenrechner kann Microsoft Edge ab Version 144 mit der verpflichtenden
Richtlinie `SilentPrintingEnabled` den Druckdialog automatisch schließen und auf den
Standarddrucker mit dessen Standardeinstellungen drucken. Die Richtlinie wird auf iOS und Android
nicht unterstützt.

Offizielle Referenz:
`https://learn.microsoft.com/deployedge/microsoft-edge-browser-policies/silentprintingenabled`

## Einmalige Einrichtung

1. POS-58 im Betriebssystem installieren und als Standarddrucker festlegen.
2. Im Druckertreiber 58-mm-Rollenpapier, den tatsächlich bedruckbaren Bereich und die gewünschte
   Schneideoption als Standard konfigurieren. Skalierung oder zusätzliche Treiberränder
   deaktivieren. Die Druckansicht belegt die gesamte vom Treiber gemeldete Papierbreite und
   zentriert darin den 56-mm-Ticketinhalt mit 52-mm-QR-Code; deshalb muss der Treiber die physische Rollenbreite
   korrekt und ohne asymmetrischen Zusatzrand melden.
3. Auf dem verwalteten Windows-Kassenrechner Microsoft Edge 144 oder neuer einsetzen.
4. Die verpflichtende Edge-Richtlinie `SilentPrintingEnabled` über die betriebliche
   Gruppenrichtlinien-/MDM-Verwaltung aktivieren.
5. Edge beziehungsweise die installierte Kassen-PWA neu starten und den Richtlinienstatus
   administrativ prüfen.
6. Ein synthetisches Testticket drucken und QR-Lesbarkeit, obere Startposition, Rollenmitte,
   Schnittposition und tatsächlichen Papierverbrauch prüfen.

Ist der Standarddrucker `Als PDF speichern`, legt Edge die Datei gemäß Browserdokumentation im
Downloadordner ab. Deshalb muss vor dem Veranstaltungsbetrieb ausdrücklich der POS-58 als
Standarddrucker geprüft werden.

## Rückfall und Abnahme

Ohne Richtlinie oder auf nicht unterstützten Plattformen bleibt der normale Druckdialog erhalten.
Das ist der sichere Rückfallpfad. Browser- und Druckertreiberupdates erfordern vor dem nächsten
Veranstaltungstag erneut einen Testdruck; die physische Hardwareabnahme kann nicht durch
Print-to-PDF ersetzt werden.
