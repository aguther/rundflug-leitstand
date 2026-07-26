# Einweisungspaket – Release 1.10.0

Die Markdown-Dateien sind die wartbaren Quellen. `npm run test:browser:roles` baut eine isolierte
lokale D1 mit synthetischen Daten auf, startet den lokalen Worker, prüft alle fünf Rollenansichten
im Browser und erzeugt die Screenshots. Ein bereits bereitgestelltes Testsystem kann stattdessen
über `ROLE_GUIDE_BASE_URL` verwendet werden. Die reproduzierbaren PDFs liegen unter
`output/pdf/roles/`.

```bash
npm run test:browser:roles
npm run docs:guides:build
npm run docs:guides:check
```

Enthalten sind Kasse, Flight Line, Flight Director, FIDS und Administration. Vor einer realen
Einweisung sind URL, Veranstaltung, Konten und lokale Notfallkontakte durch den Betreiber zu
ergänzen; PINs oder Codes gehören nicht in diese Unterlagen.
