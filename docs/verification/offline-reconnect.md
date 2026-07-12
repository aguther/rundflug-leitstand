# Verifikation Offline-Überbrückung und Wiederverbindung

Stand: 12.07.2026

## Fachliche Grenze

Gemäß OQ-01 werden operative Kommandos ohne Serververbindung abgelehnt. Lokal erhalten bleiben nur
der letzte bestätigte Betriebsstand und vorbereitende, reversible Kassenentwürfe. Dadurch kann ein
Offline-Zustand keine öffentliche oder operative Wirkung vortäuschen.

## Automatisierter 60-Sekunden-Nachweis

`apps/web/src/board-sync.test.ts` simuliert zwölf fehlgeschlagene Abrufe im Abstand von fünf Sekunden.
Während der gesamten Minute bleiben Board-Objekt, Event-Version und Zeitpunkt der letzten
Serverbestätigung unverändert erhalten. Der nächste erfolgreiche Abruf wird ohne Neustart übernommen,
entfernt die Störungsmeldung und ersetzt den Stand nur bei gleicher oder neuerer Event-Version.

`apps/web/src/api.test.ts` weist separat nach, dass operative Kommandos offline vor dem Transport
abgelehnt werden. `apps/web/src/offline-store.test.ts` prüft Altersanzeige und sicheres Degradieren bei
nicht verfügbarem Browserspeicher.

## Browserprüfung

Geprüfter Ablauf: Kasse online mit synthetischem Board → lokaler Worker beendet → nächster Poll schlägt
fehl → bestätigtes Board bleibt sichtbar → Hinweis zeigt „Möglicherweise veraltet“ und Alter der
letzten Bestätigung → Gruppengröße als vorbereitender Entwurf änderbar → Verkauf bleibt gesperrt.

Beobachtetes Ergebnis: Der Stand „20 Min. Panorama“ blieb sichtbar, die Altersanzeige erschien nach
sieben Sekunden, der Entwurf wechselte von zwei auf drei Tickets und die primäre Verkaufsaktion blieb
deaktiviert. Browserkonsole ohne Warnungen oder Fehler.
