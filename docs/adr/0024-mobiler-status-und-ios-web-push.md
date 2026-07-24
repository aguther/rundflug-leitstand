# ADR-0024: Mobiler öffentlicher Status und iOS-Web-Push

- Status: Akzeptiert
- Datum: 2026-07-23
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: F-BEN-020, F-BEN-090 und Q-DSG-030

## Kontext

Die bisherigen Ticket- und Gruppenseiten verwendeten abweichende öffentliche Texte, eine
platzintensive Fortschrittsanzeige und einen schlecht kontrastierenden Dark Mode. Auf dem iPhone
wurde Web Push im normalen Browser angeboten, obwohl Apple Web Push ab iOS/iPadOS 16.4 nur für zum
Home-Bildschirm hinzugefügte Web-Apps freischaltet. WebKit verlangt dafür ein Manifest mit
Standalone-Darstellung und eine Berechtigungsanfrage nach direkter Nutzerinteraktion:
<https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/>.

## Entscheidung

- Ticket und Buchungsgruppe verwenden dieselbe FIDS-nahe, symbolgestützte Statusabbildung gemäß
  `docs/ui/v1.8.0-public-status-mobile-concept.md`.
- Ein dynamisches Manifest verwendet den exakten relativen Statuspfad als `id` und `start_url`.
  Dadurch öffnet jede installierte Web-App wieder genau das installierte Ticket beziehungsweise die
  Gruppe und nicht die Loginroute.
- `name`, `short_name` und der Apple-App-Titel verwenden die Ticketgruppenkennung; ein eigenes
  Ticket-Symbol ersetzt auf öffentlichen Statusinstallationen das allgemeine Leitstand-Symbol.
  Die Metadaten werden für Ticket-/Gruppenrouten serverseitig in den ersten HTML-Stream geschrieben,
  damit die Installationsauswahl nicht vom späteren React-Render abhängt.
- Kasse, Flight Line, Assist, FIDS und Admin besitzen getrennte statische Manifeste und Symbole.
  Auch deren Metadaten werden auf der jeweiligen Einstiegsroute in den ersten HTML-Stream
  geschrieben; `id` und `start_url` entsprechen der Oberfläche.
- Der generische Workbox-Navigationsfallback darf Ticket, Gruppe und die installierbaren
  Betriebsoberflächen nicht aus dem vorgecachten `index.html` bedienen. Diese Navigationen gehen
  immer zum Worker, damit der Browser bereits beim Parsen des ersten Dokuments das seitenspezifische
  Manifest auswählt. Eine spätere Änderung des Manifest-Links durch React ist nur ein Fallback und
  nicht Teil der Installationskorrektheit.
- Auf iPhone/iPad bleibt Push im normalen Browser deaktiviert. Im Standalone-Modus wird der
  vorhandene W3C-Push-Ablauf verwendet. Die Ausnahme konkretisiert F-BEN-020 nur für die technisch
  durch iOS vorgegebene Plattformgrenze; unterstützte Desktop- und Android-Browser bleiben
  installationsfrei.
- Migration 0043 ergänzt `target_kind` (`TICKET` oder `GROUP`). Bestehende Abonnements werden
  kanonisch auf `GROUP` zurückgeführt. Neue Registrierungen speichern ihren tatsächlichen Zieltyp.
- Der Worker leitet den relativen Rücksprungpfad ausschließlich aus `target_kind` und dem
  serverseitig gespeicherten öffentlichen Code ab. Clientgelieferte Rücksprungpfade werden weder
  gespeichert noch vertraut. Der Service Worker akzeptiert ausschließlich relative
  `/ticket/:code`- und `/gruppe/:code`-Pfade.
- Die bestehende Apple-Endpunktfreigabe `*.push.apple.com` bleibt erhalten. Codes werden nicht
  geloggt; Push-Ziele bleiben aus portablen R2-Backups ausgeschlossen.

## Folgen und Wiederherstellung

Vor Migration 0043 wird eine D1-Time-Travel-Marke oder vollständige D1-Sicherung angelegt. Ein
Rollback erfolgt per D1 Time Travel oder aus dieser Sicherung, da D1 additive Spalten nicht ohne
Tabellenneuaufbau entfernt. Push-Daten werden bewusst nicht aus portablen Backups wiederhergestellt;
betroffene Gäste erteilen die Einwilligung erneut.

Die automatisierte Abnahme deckt Statuscopy, Manifestpfade, Zieltypen, Bestandsmigration,
ansichtsspezifische Installationsprofile, Widerruf und fehlende Code-/PII-Exposition ab. Die reale
iPhone-Zustellung bleibt eine Originalhardwareprüfung und darf durch Desktop-Emulation nicht als
bestanden markiert werden.
