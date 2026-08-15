# ADR-0047: Operative UI-Shell und bewusste PWA-Updates

- Status: Akzeptiert
- Datum: 2026-08-15
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: T-010, V17-UI-020, V17-UI-040, V171-ACT-010, V19-RTE-010,
  V191-CAS-010
- Ersetzt: ADR-0020 hinsichtlich der gemeinsamen Overlay-Fläche für persistente Meldungen

## Kontext

Persistente Betriebs-, Offline- und Fehlermeldungen wurden bisher gemeinsam mit kurzlebigen
Aktionsbestätigungen als schwebende Overlays dargestellt. Auf schmalen operativen Oberflächen konnten
sie dadurch Controls verdecken. Gleichzeitig konnte der PWA-Service-Worker einen neuen Stand ohne
bewusste Bedienhandlung laden. Ein Reload während einer geänderten Eingabe oder eines laufenden
Schreibkommandos würde nicht bestätigten UI-Zustand verlieren.

Die bestehenden Kassen-, Flight-Line- und Flight-Director-Oberflächen sind eingespielte
Ein-Bildschirm-Abläufe. Ihre Informationsarchitektur und insbesondere die getrennte
Flight-Line-Übernahmefreigabe dürfen durch die Korrektur nicht neu interpretiert werden.

## Entscheidung

- Persistente Betriebs-, Offline-, Konflikt-, Fehler- und Updatezustände verwenden eine reservierte
  Inline-Region direkt unter dem App-Header. Nur kurzlebige Aktionsbestätigungen dürfen weiterhin als
  schwebende Toasts erscheinen.
- Auf iPhone-Breiten bilden Header und aktive Hinweisregion in Kasse, Flight Line und Flight Director
  einen deckenden Sticky-Stack. Es wird nur der höchstpriorisierte Hinweis gezeigt; weitere Hinweise
  werden über eine zugängliche Anzahl aufklappbar gemacht. Im Normalzustand existiert kein leerer
  Hinweisplatz.
- Der Service Worker verwendet den Prompt-Modus. Ein interner Zustand
  `idle | available | blocked | applying | failed` zeigt das Update an und lädt es ausschließlich
  nach „Jetzt aktualisieren“. „Später“ behält den aktuellen Stand bei.
- Eine tokenbasierte Dirty-/Pending-Registry blockiert den Reload, solange mindestens ein geändertes
  Formular oder ein laufendes Schreibkommando registriert ist. Ein bereits bewusst angefordertes
  Update wird erst nach Freigabe aller Tokens angewandt.
- Nach der bewussten Freigabe bleibt der vom PWA-Plugin gesteuerte Service-Worker-Wechsel der
  Primärpfad. Falls er innerhalb von vier Sekunden keinen Navigationswechsel auslöst, erzwingt die
  Anwendung genau einen normalen Seiten-Reload. Ein abgewiesener Updateversuch löscht diesen Fallback
  und wechselt in `failed`.
- Die zustandsabhängige Standardaktion von Flight Line und Flight Director behält Icon, Position und
  Zustandslogik und erhält lediglich ein sichtbares deutsches Textlabel in einem je Breakpoint festen
  Slot. `Flugzeug freigeben` bleibt davon getrennt und ändert keinen Flugzeugzustand.
- Unbekannte Frontendpfade zeigen eine eigene zugängliche Not-found-Seite mit sicheren Rückwegen.
  Sie mounten nicht implizit die Kasse. Unbekannte `/api/*`-Routen bleiben HTTP 404.

## Folgen

- Öffentliche JSON-Verträge, Datenbankschema, Auditierung und fachliche Zustandsautomaten ändern sich
  nicht.
- Persistente Hinweise beanspruchen sichtbaren Platz, überdecken aber keine operative Aktion. Mobile
  Scrollcontainer dürfen den Sticky-Kontext nicht durch `overflow: hidden` aufbrechen.
- Ein Update kann länger angeboten werden, wenn auf dem Gerät noch lokale Arbeit offen ist. Der
  Bediener behält die Entscheidung über den Reload; ein fehlgeschlagener Versuch lässt die aktuelle
  Oberfläche bedienbar.
- ADR-0020 bleibt als Entscheidungshistorie für die Trennung transienter und persistenter Meldungen
  erhalten. Seine gemeinsame Overlay-Fläche ist durch diese Entscheidung ersetzt.

## Verworfene Alternativen

- **Automatischer Reload bei Service-Worker-Update:** kann geänderte Eingaben oder laufende Aktionen
  unterbrechen.
- **Alle Meldungen weiterhin als Overlay:** schützt den Dokumentfluss, kann auf kleinen Displays aber
  operative Controls verdecken.
- **Mehrere dauerhafte Banner untereinander:** verbraucht unvorhersehbar viel Höhe und erzeugt neue
  Layoutsprünge.
- **Unbekannte Pfade auf die Kasse fallen lassen:** verschleiert Routingfehler und startet unnötige
  Kassen-Datenzugriffe.
