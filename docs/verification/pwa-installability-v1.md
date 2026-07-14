# PWA-Installierbarkeit V1

Stand: 14. Juli 2026

Betroffene Anforderung: T-010.

Die React-Anwendung wird als responsive Progressive Web App ohne App-Store-Abhängigkeit gebaut:

- Web-App-Manifest mit deutschem Namen, Start-URL, Scope und `display: standalone`,
- automatisch aktualisierter Service Worker mit Navigation-Fallback,
- 192- und 512-Pixel-PNG-Icons für die reguläre Installation,
- separates 512-Pixel-Maskable-Icon mit sicherem Innenbereich,
- Apple-Touch-Icon und Browser-Theme-Farbe,
- Wiederverwendung des bereits in der Kopfzeile eingesetzten anonymen Flugzeug-Markenzeichens.

`apps/worker/src/pwa-installability.test.ts` verhindert fehlende Dateien oder unvollständige
Manifest-Angaben. `npm run build:web` erzeugte am 14. Juli 2026 erfolgreich
`manifest.webmanifest`, `sw.js`, die Workbox-Datei und elf Precache-Einträge. Das erzeugte Manifest
enthielt alle drei Installationsicons; die Dateien lagen im Produktionsartefakt unter `/icons/`.

Die responsive Bedienbarkeit der eigentlichen Oberflächen ist separat in den jeweiligen
UI-Verifikationsdokumenten für 430 bis 1600 Pixel nachgewiesen. Die plattformübergreifende
Browserabnahme aus T-020 bleibt davon getrennt.
