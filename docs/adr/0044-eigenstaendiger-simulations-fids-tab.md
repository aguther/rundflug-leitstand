# ADR-0044: Eigenständiger Simulations-FIDS-Tab mit lokalem Zustandskanal

- Status: Akzeptiert
- Datum: 2026-08-13
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: V173-QA-010

## Kontext

Das simulierte FIDS wurde bisher aus der Simulatoransicht per React-Portal in ein mit
`window.open` erzeugtes Popup gerendert. Die URL `/simulation/fids` besaß keine eigene Route. Beim
regulären Laden fiel sie deshalb im lokalen Modus auf die Anmeldung und im gehosteten Modus auf die
geschützte Standardnavigation zurück. Der Portalcode ersetzte anschließend Dokumentkopf und Inhalt
des fremden Fensters. Navigation, Reload, Popup-Blocker und Unmount des Simulator-Tabs konnten damit
die Anzeige oder den laufenden Simulator beenden.

Ein direkt aufrufbarer FIDS-Tab benötigt weiterhin den vollständig lokalen Simulationszustand. Er
darf weder eine zweite Simulationsengine starten noch Ergebnisse in Worker, D1 oder Browser-Storage
persistieren. Gleichzeitig müssen große deterministische Ergebnisobjekte von den häufigen
Uhraktualisierungen getrennt bleiben.

## Entscheidung

### Eigenständige Route und Berechtigung

`/simulation/fids` ist eine eigenständige React-Route. Im Vite-Simulatormodus ist sie wie
`/simulation` ohne Worker und Anmeldung erreichbar. Im gehosteten Build durchläuft sie die bestehende
Anmeldung, Veranstaltungsauswahl und Rollenprüfung und bleibt ausschließlich für `ADMIN` zulässig.
Sie lädt die gemeinsame FIDS-Experience, den URL-Adapter, Einstellungsdialog sowie Fixed-/Split-,
Filter- und Timerlogik regulär als eigenen React-Baum.

Der Simulator bietet einen normalen Link mit `target="_blank"` und `rel="noopener"` an. Er erzeugt
kein Popup, erhält keinen Fensterverweis, manipuliert kein fremdes Dokument und schließt keinen
anderen Tab.

### Versionierter lokaler Zustandskanal

Simulator und FIDS verwenden ausschließlich gleichursprünglich den `BroadcastChannel`
`rundflug-simulation-fids:v1`. Jede Nachricht trägt `protocolVersion: 1`, einen Sendezeitpunkt und
einen der folgenden Typen:

- `REQUEST_STATE` fordert den vollständigen Zustand einer bestimmten oder einer verfügbaren Quelle
  an;
- `STATE` überträgt Ergebnis, virtuelle Uhr, sichtbaren Tick, Geschwindigkeit und Laufstatus beim
  Start, auf Anfrage oder nach einer Ergebnisänderung;
- `TICK` überträgt nur Uhr, sichtbaren Tick, Geschwindigkeit und Laufstatus und dient auch bei Pause
  als Heartbeat;
- `SOURCE_STOPPED` meldet das reguläre Ende eines Simulator-Tabs.

Jeder Simulator besitzt eine zufällige lokale Quellen-ID. Sie wird als nicht sensitiver URL-Zustand
in `source` geführt und bleibt dadurch bei einem Reload desselben Tabs stabil, ohne Browser-Storage
zu benötigen. Ein aus dem Simulator geöffneter FIDS-Link bindet sich direkt an diese ID. Ein direkter
Aufruf ohne `source` sammelt die aktuellen Antworten, bindet sich an die zuletzt aktive Quelle und
ergänzt deren ID per `history.replaceState`. Danach werden Nachrichten anderer Simulatorquellen
ignoriert. Mehrere FIDS-Tabs dürfen dieselbe Quelle lesen.

### Warte- und Trennzustand

Vor dem ersten bestätigten `STATE` zeigt die Route einen kompakten Wartezustand mit einem Link, der
den Simulator in einem weiteren Tab öffnet. Sie startet selbst keinen Lauf. Nach drei ausgebliebenen
Heartbeats beziehungsweise `SOURCE_STOPPED` bleibt der letzte Zustand ausschließlich im Speicher
sichtbar und wird als `SIMULATION GETRENNT` gekennzeichnet. Eine Nachricht derselben Quellen-ID stellt
die Liveverbindung automatisch wieder her.

FIDS-Präferenzen bleiben je FIDS-Tab im Speicher. `page` und `setup` behalten ihre bestehende
URL-Semantik. Der Kanal verwendet weder `localStorage`, `sessionStorage`, IndexedDB, Service Worker,
API, WebSocket noch Cloudflare-Persistenz.

## Verworfene Alternativen

- **React-Portal im Popup reparieren:** behält die Lebenszyklus- und Dokumentkopplung sowie
  Popup-Blocker bei und ermöglicht keinen robusten Direktaufruf.
- **Vollständigen Zustand in jedem Tick senden:** kopiert große Ergebnisobjekte unnötig häufig und
  belastet Simulator und FIDS bei beschleunigter Wiedergabe.
- **Letzten Zustand im Browser persistieren:** widerspricht dem rein flüchtigen Simulator und kann
  veraltete Ergebnisse beim späteren Direktaufruf als aktuell erscheinen lassen.
- **Eigenen Standardlauf im FIDS starten:** erzeugt zwei voneinander abweichende Simulationen und
  trennt die Anzeige von den im Simulator vorgenommenen Änderungen.

## Folgen und Nachweise

- Reload, Navigation oder Schließen des FIDS-Tabs verändert den Simulatorzustand nicht.
- Ein pausierter Simulator bleibt durch kleine Heartbeats verbunden; große Ergebnisse werden nur bei
  fachlich relevanten Änderungen übertragen.
- Die gehostete Route erweitert keine Rolle und keine öffentliche Schnittstelle.
- DOM- und Routingtests decken Direktaufruf, Berechtigung, Quellenwahl, mehrere Quellen,
  Ergebniswechsel, Heartbeats, Trennung, Wiederaufnahme und URL-Erhalt ab.
- Die Browserabnahme prüft Simulator und FIDS als getrennte Tabs sowie Light/Dark bei 1920×1080 und
  1280×720.
