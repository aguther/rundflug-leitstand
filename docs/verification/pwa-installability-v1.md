# PWA-Installierbarkeit V1

Stand: 25. Juli 2026

Betroffene Anforderung: T-010.

Die React-Anwendung wird als responsive Progressive Web App ohne App-Store-Abhängigkeit gebaut:

- Web-App-Manifest mit deutschem Namen, Start-URL, Scope und `display: standalone`,
- automatisch aktualisierter Service Worker mit Navigation-Fallback,
- 192- und 512-Pixel-PNG-Icons für die reguläre Installation,
- separate 192- und 512-Pixel-Maskable-Icons mit sicherem Innenbereich,
- Apple-Touch-Icon, ansichtsspezifisches SVG-Favicon und Browser-Theme-Farbe,
- getrennte Identitäten für Hauptmarke, Kasse, Flight Director, Flight Line, FIDS, Admin und
  öffentlichen Ticket-/Gruppenstatus.

`apps/worker/src/pwa-installability.test.ts` verhindert fehlende Dateien oder unvollständige
Manifest-Angaben. Der Test liest außerdem die PNG-Header aller 35 Plattformdateien, prüft ihre
Abmessungen und kontrolliert die drei verbindlichen Markenfarben in allen sieben SVG-Favicons.
Der Produktionsbuild übernimmt ausschließlich den schlanken Laufzeitsatz unter `/icons/pwa/`;
die vollständige Designreferenz unter `docs/ui/icon-system/` wird nicht ausgeliefert.

Die Abnahme vom 25. Juli 2026 war vollständig erfolgreich: `npm run check` einschließlich
Produktionsbuild, 688 Vitest-Tests, Integrationsläufen, Dokumentations- und Requirements-Prüfung
lief grün. Im lokalen Produktions-Worker wurden Root, Kasse, Flight Director, Flight Line, FIDS,
FIDS-Terminal, Admin sowie synthetische Ticket- und Gruppenpfade geprüft. Manifest, Favicon,
Apple-Touch-Icon und Titel waren jeweils schon im ersten Dokument korrekt; die SVG-Favicons wurden
in heller und dunkler Farbumgebung gerendert. Die Kassen-Anmeldung blieb bei 390 Pixeln ohne
horizontalen Überlauf bedienbar, der Darstellungsumschalter reagierte, und die Browser-Konsole
enthielt keine Warnungen oder Fehler.

Die responsive Bedienbarkeit der eigentlichen Oberflächen ist separat in den jeweiligen
UI-Verifikationsdokumenten für 430 bis 1600 Pixel nachgewiesen. Die plattformübergreifende
Browserabnahme aus T-020 bleibt davon getrennt.

Da Android, iOS und Browser installierte Symbole zusätzlich außerhalb des Service Workers
zwischenspeichern können, verwenden die neuen Profile neue Assetpfade. Bereits installierte
Verknüpfungen können trotzdem ein einmaliges Entfernen und erneutes Hinzufügen erfordern.
