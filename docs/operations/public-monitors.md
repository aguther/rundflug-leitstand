# FIDS-Monitore mit Display-Konto

Die FIDS-Webanwendung ist in Release 1.11.0 mit einem aktiven Konto der Rolle `DISPLAY` oder `ADMIN`
erreichbar. Für dauerhaft betriebene Monitore ist ein eigenes Display-Konto vorgesehen. Die feste
Anzeige-URL lautet:

```text
https://<Worker-Domain>/fids?event=<Veranstaltungs-ID>
```

`page=<Seite>` weist dem Browserfenster eine feste, 1-basierte Seite zu. Beispiel für zwei Monitore
mit demselben Konto:

```text
https://<Worker-Domain>/fids?event=<Veranstaltungs-ID>&page=1
https://<Worker-Domain>/fids?event=<Veranstaltungs-ID>&page=2
```

Die Seite wird ausschließlich aus der URL gelesen und niemals im Konto gespeichert. `setup=1`
blendet vorübergehend die Einrichtungsleiste ein. „Link kopieren“ entfernt diesen Setupzustand sowie
alle weiteren Parameter. Das geschützte FIDS wertet die früheren URL-Parameter `gateId` und `gate`
nicht mehr aus; Gatefilter werden ausschließlich im geschützten Einstellungsdialog gepflegt. Ein
Terminalprofil existiert nicht.

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

- 4 bis 20 „Anzeigeplätze gesamt“, Standard 8;
- feste URL-Seite oder geteilte Ansicht;
- in der geteilten Ansicht 1 bis 19 „Oben reservierte Plätze“, stets weniger als die sichtbaren
  Zeilen;
- 5 bis 60 Sekunden „Seitenwechsel unten“ für ausschließlich den unteren Bereich;
- eine oder zwei Spalten; zwei Spalten werden erst ab 1280 CSS-Pixel dargestellt;
- Darstellung nach System, Hell oder Dunkel;
- mehrere Produkte und Gates; „Alle“ ist als leere Auswahlliste gespeichert;
- Setup aktivieren beziehungsweise beenden;
- Abmelden.

Speichern wird erst nach Serverbestätigung wirksam. Bei einem Versionskonflikt oder Fehler bleibt
der Dialog offen. Einstellungen gelten genau für das angemeldete Display- oder Administratorkonto
und die aktuelle Veranstaltung. Alle Geräte desselben Kontos teilen diese Werte. Unterschiedliche
Filter benötigen daher unterschiedliche DISPLAY-Konten; unterschiedliche feste Seiten können
dagegen über `page` mit demselben Konto betrieben werden. Unter 1280 Pixel bleibt eine
Zweispaltenwahl gespeichert, wird aber vorübergehend in einer Spalte angezeigt.

Der Dialog zeigt die resultierende Aufteilung in obere und untere Plätze unmittelbar an. Die
Nachlaufzeit kürzlich abgeflogener Gruppen ist eine Veranstaltungseinstellung; ein Hinweis nennt den
aktiven Wert und verweist für Änderungen auf die Administration. Der Dialog ändert diesen Wert nicht.

Produkt- und Gatefilter werden vor Sortierungsausschnitt und Paging im Worker angewendet. Innerhalb
einer Filtergruppe gilt ODER, zwischen Produkt und Gate AND. Inaktive, aber noch vorhandene Produkte
bleiben sichtbar gekennzeichnet. Ist eine gespeicherte ID nicht mehr verfügbar, weist der Dialog vor
dem bestätigten Speichern darauf hin; ein Ladefehler setzt Filter niemals still zurück.

Benötigen zwei Monitore verschiedene Inhalte, werden beispielsweise zwei Konten so eingerichtet:

```text
DISPLAY-01:
Gate A
alle Produkte

DISPLAY-02:
Gate B
Produkt Rundflug XL
```

Die jeweilige Auswahl gilt anschließend für alle Geräte des betreffenden Kontos und nur für die
aktuelle Veranstaltung.

## Ansichtsmodi

`FIXED_PAGE` zeigt genau die URL-Seite und wechselt sie auch bei Realtime-Updates nicht. Eine leere
Seite bleibt als klarer Leerzustand stehen; die Setup-Leiste erlaubt die Korrektur und das Kopieren
der kanonischen URL.

`SPLIT` zeigt oben zuerst `BOARDING` und `BITTE ZUM GATE`. Danach folgen `ABGEFLOGEN`, `GELANDET` und
`ABGESCHLOSSEN`, solange ihre `departedAt`-Zeit innerhalb der veranstaltungsweit konfigurierten
Nachlaufzeit liegt; die jüngste Zeit steht zuerst. `BEREITHALTEN` füllt anschließend freie reservierte
Plätze. Handlungsrelevante und kürzlich abgeflogene Gruppen dürfen den oberen Bereich gemeinsam bis
zur gesamten Zeilenkapazität erweitern. Weiterer relevanter Überlauf wird als Anzahl angezeigt. Diese
Kategorien erscheinen nie unten. Nur der disjunkte übrige Bereich rotiert, und nur wenn mehr als eine
Unterseite existiert. Die Seiteninformation steht in der Überschrift „WEITERE FLÜGE“.

Eine typische Konfiguration lautet:

```text
viewMode = SPLIT
priorityGroupCount = 3
rotationIntervalSeconds = 12
```

Das Simulations-FIDS verwendet dieselben Ansichtsmodi, Filter, URL-Seiten, Setup-Steuerung und
responsiven Tabellen. Es wird über „FIDS öffnen“ aus der Prognose-Simulation gestartet und bleibt
durch das sichtbare Simulationsbanner eindeutig von Betriebsdaten getrennt. Seine Einstellungen
bleiben im Simulationszustand und überschreiben keine produktiven Präferenzen.

## Vor Veranstaltungsbeginn prüfen

- Monitor startet ohne zusätzliche Interaktion und öffnet die richtige Veranstaltung und feste
  Seite beziehungsweise geteilte Ansicht.
- Im Kopf stehen Veranstaltungsname sowie Veranstaltungslogo oder Plane-Fallback in ausreichender
  Größe.
- `GO TO GATE` und `BOARDING` stehen unabhängig von Produkt und Ressourcengruppe vor allen anderen
  Zeilen; pausierte Gruppen erscheinen als `VERZÖGERT`.
- Ein aktiver Nachruf erscheint direkt in der betroffenen Gruppenzeile als zusätzlicher
  amberfarbener Status mit Glocke; der normale Umlaufstatus bleibt daneben sichtbar. Die Glocke
  pulsiert nur, wenn das Betriebssystem Bewegung nicht reduziert.
- Gewählte 4, 8 beziehungsweise 20 Zeilen sind bei genügend Daten vollständig sichtbar.
- Oberer und unterer Bereich verwenden dasselbe Zeilenraster; ihre sichtbaren Zeilenhöhen unterscheiden
  sich höchstens um 1 Pixel. Lange Gruppen-, Produkt- und Gatebezeichnungen erzeugen keinen Umbruch.
- Bei 1920×1080, 1440×900, 1280×720, 1024×768, 800×600 und 640×600 entstehen weder horizontale
  noch vertikale Dokument- oder Tabellenscrollbars.
- Setup-Leiste und Einstellungsdialog sind vollständig erreichbar; der Dialog besitzt nur einen
  inneren Scrollbereich und feste Kopf-/Aktionsflächen.
- In `SPLIT` bleibt der obere Bereich während mindestens eines vollständigen unteren
  Rotationsintervalls unverändert und keine Gruppe erscheint gleichzeitig in beiden Bereichen.
- Eine synthetisch als abgeflogen markierte Zeile erscheint während der Nachlaufzeit oben, nie auf
  einer Unterseite und verschwindet nach Ablauf ohne eng getaktete Neuladeschleife.
- Ein Filtertest mit je zwei Produkten und Gates entspricht ODER innerhalb und AND zwischen den
  Dimensionen; eine leere Auswahl zeigt alle.
- Eine Teständerung erscheint ohne Neuladen; nach kurzer Netzunterbrechung verbindet sich die
  Anzeige selbständig neu und behält bis dahin den letzten bestätigten Board-Stand.
- Notfall- beziehungsweise Unterbrechungshinweis ist sichtbar, ohne den Viewport zu überlaufen.
- Bereichsbezogene Leer- oder Fehlerzustände bleiben innerhalb ihres Bereichs und überdecken keine
  Überschrift oder zweite Tabelle.

Die Ansicht empfängt über WebSocket nur ein minimales Versionssignal. Bei Verbindungsabbruch erfolgt
eine begrenzte exponentielle Neuverbindung; ein 15-Sekunden-Polling dient als Rückfallebene. Die
Standard-Nachlaufzeit für „Abgeflogen“ beträgt 15 Sekunden und ist pro Veranstaltung zwischen 5 und
900 Sekunden konfigurierbar. Bei einem vorübergehenden Server- oder D1-Fehler wird das letzte
bestätigte Board mit sichtbarem Offline-Status weiter angezeigt.
