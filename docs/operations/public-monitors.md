# FIDS-Monitore mit Display-Konto

Die FIDS-Webanwendung ist ab Release 1.7.3 mit einem aktiven Konto der Rolle `DISPLAY` oder `ADMIN`
erreichbar. Für dauerhaft betriebene Monitore ist ein eigenes Display-Konto vorgesehen. Die feste
Anzeige-URL lautet:

```text
https://<Worker-Domain>/fids?event=<Veranstaltungs-ID>
```

Optional grenzt `gateId=<Gate-ID>` die Anzeige ein. Veranstaltung und Gate sind URL- beziehungsweise
kontextgebunden und nicht Teil des Einstellungsdialogs. Alte URLs mit `/fids/terminal` oder
`style=terminal` werden auf die Standardansicht normalisiert. Ein Terminalprofil existiert nicht
mehr.

Die anonym lesbaren Endpunkte `/api/public/events/:eventId/board` und
`/api/public/events/:eventId/logo` bleiben für bestehende Besucherintegrationen verfügbar. Die
FIDS-Seite selbst sowie GET und PUT der FIDS-Einstellungen benötigen jedoch eine gültige Display-
oder Administrator-Sitzung. Display-Konten haben keinen Zugriff auf Kasse, Flight Line oder
Administration. Administratoren behalten `/admin` als Startseite und dürfen FIDS zusätzlich öffnen.

## Konto und Anmeldung

1. In der Administration ein Konto der Rolle „FIDS-Anzeige“ anlegen, beispielsweise `DISPLAY-01`.
2. Auf dem Abspielgerät `/fids` öffnen, Display-Konto auswählen und mit der vergebenen PIN anmelden.
3. Veranstaltung auswählen beziehungsweise die feste Event-URL aufrufen.
4. Browser in Vollbild-/Kioskmodus versetzen. Ruhezustand und Bildschirmschoner für den
   Veranstaltungstag deaktivieren.

Die Display-Sitzung läuft absolut 90 Tage und besitzt keinen früheren Idle-Ablauf. Für
Administrator-Sitzungen gilt weiterhin die reguläre Laufzeit von 16 Stunden. Abmeldung,
Kontodeaktivierung, PIN-Wechsel oder administrativer Sitzungswiderruf beenden die Berechtigung
sofort. Die PIN wird weder in der URL noch im lokalen Speicher abgelegt.

## Anzeige einstellen

Der dezente Zahnradbutton rechts unten öffnet die kontobezogenen Einstellungen:

- 4 bis 20 sichtbare Zeilen, Standard 8;
- eine oder zwei Spalten; zwei Spalten werden erst ab 1280 CSS-Pixel dargestellt;
- Darstellung nach System, Hell oder Dunkel;
- Abmelden.

Speichern wird erst nach Serverbestätigung wirksam. Bei einem Versionskonflikt oder Fehler bleibt
der Dialog offen. Einstellungen gelten genau für das angemeldete Display- oder Administratorkonto
und die aktuelle Veranstaltung. Unter 1280 Pixel bleibt eine Zweispaltenwahl gespeichert, wird
aber vorübergehend in einer Spalte angezeigt.

## Vor Veranstaltungsbeginn prüfen

- Monitor startet ohne zusätzliche Interaktion und öffnet die richtige Veranstaltung und das
  richtige Gate.
- Im Kopf stehen Veranstaltungsname sowie Veranstaltungslogo oder Plane-Fallback in ausreichender
  Größe.
- `GO TO GATE` und `BOARDING` stehen unabhängig von Produkt und Ressourcengruppe vor allen anderen
  Zeilen; pausierte Gruppen erscheinen als `VERZÖGERT`.
- Gewählte 4, 8 beziehungsweise 20 Zeilen sind bei genügend Daten vollständig sichtbar.
- Bei 1920×1080, 1366×768, 1280×720, 1024×768, 800×600 und 430×900 entstehen weder horizontale
  noch vertikale Dokument- oder Tabellenscrollbars.
- Eine Teständerung erscheint ohne Neuladen; nach kurzer Netzunterbrechung verbindet sich die
  Anzeige selbständig neu und behält bis dahin den letzten bestätigten Board-Stand.
- Notfall- beziehungsweise Unterbrechungshinweis ist sichtbar, ohne den Viewport zu überlaufen.
- Eine synthetisch als abgeflogen markierte Zeile verschwindet nach der konfigurierten Nachlaufzeit,
  bleibt aber in Ticketstatus und Historie erhalten.

Die Ansicht empfängt über WebSocket nur ein minimales Versionssignal. Bei Verbindungsabbruch erfolgt
eine begrenzte exponentielle Neuverbindung; ein 15-Sekunden-Polling dient als Rückfallebene. Die
Standard-Nachlaufzeit für „Abgeflogen“ beträgt 15 Sekunden und ist pro Veranstaltung zwischen 5 und
900 Sekunden konfigurierbar. Bei einem vorübergehenden Server- oder D1-Fehler wird das letzte
bestätigte Board mit sichtbarem Offline-Status weiter angezeigt.
