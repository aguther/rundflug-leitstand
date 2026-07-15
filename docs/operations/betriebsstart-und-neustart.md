# Betriebsstart und sicherer Neustart

Diese Anleitung beschreibt den Start eines Veranstaltungstags und den sicheren Neustart. Ein
„Reset“ löscht bewusst keine bestehende Veranstaltung: Der Leitstand legt einen neuen,
betriebsleeren Veranstaltungstag an. Dadurch bleiben Audit-Historie, Berichte und die Möglichkeit
zur Wiederherstellung erhalten.

## 1. Einmalige Cloudflare-Einrichtung

1. D1-Datenbank und R2-Bucket in EU-Jurisdiktion anlegen und in `wrangler.jsonc` binden.
2. Migrationen auf D1 anwenden und den Worker aus `main` bereitstellen.
3. `ADMIN_PIN_HASH` und den einmaligen `BOOTSTRAP_TOKEN` als Cloudflare-Secrets einrichten. Secrets
   niemals in Dateien oder Logs schreiben.
4. Nach dem ersten Deployment `/setup` öffnen und dort die erste Veranstaltung sowie das anonyme
   Administrationsgerät anlegen. Der Setup-Zugang sperrt sich danach dauerhaft.
5. Web-Push mit `npm run cloudflare:configure-push` einrichten. Ohne diese Werte funktioniert der
   übrige Leitstand, aber die verbindliche V1-Browserbenachrichtigung ist nicht betriebsbereit.
6. Healthcheck, Administrationsoberfläche, D1-Sicherung nach R2 und einen Wiederherstellungstest
   prüfen.

Die konkreten Cloudflare-Schritte und Befehle stehen in [cloudflare-setup.md](cloudflare-setup.md),
das Sicherungs- und Wiederherstellungsverfahren in [backup-restore.md](backup-restore.md).

## 2. Veranstaltung vorbereiten

1. Administration öffnen und das richtige Veranstaltungsdatum kontrollieren.
2. Veranstaltungsparameter festlegen: Verkaufsbeginn, Betriebsende, No-Show- und
   Benachrichtigungsfristen sowie Planzeiten.
3. Gates, Ressourcengruppen und Produkte einrichten. Jedes Produkt muss genau einer
   Ressourcengruppe zugeordnet sein.
4. Flugzeuge und Piloten-IDs erfassen und Flugzeuge den Ressourcengruppen zuordnen.
5. Kassen-, Flight-Line- und Anzeigegeräte koppeln. Kopplungs-QR-Codes nur am vorgesehenen Gerät
   zeigen.
6. Testticket mit synthetischen Daten verkaufen und den Ablauf bis `VERFÜGBAR` prüfen. Danach für
   den echten Betrieb einen sicheren Neustart anlegen.

## 3. Kontrolle unmittelbar vor Öffnung

- Eine aktuelle R2-Sicherung ist vorhanden.
- Mindestens ein zweites Administrationsgerät ist einsatzbereit.
- Kasse und Flight Line erreichen den Leitstand; öffentliche Anzeige und Ticketstatus laden.
- Flugzeuge sind höchstens einer aktiven Ressourcengruppe zugeordnet.
- Produkte, Preise, Gates, Kapazitäten und Verkaufsstatus sind geprüft.
- Web-Push wurde auf einem echten Besuchergerät erlaubt und getestet.
- Papier- und Offlineverfahren liegen bereit.

Erst danach in der Administration eine Begründung und die Administrator-PIN eingeben und
`Veranstaltung aktivieren` wählen.

## 4. Neustart-Stufen

In **Administration → Veranstaltungen und Vorlagen** die neue technische ID, Bezeichnung, Datum und
den Flugplatz eingeben, eine Stufe wählen und zur Bestätigung exakt `NEUSTART` schreiben.

### Betriebsdaten zurücksetzen

Diese Stufe übernimmt:

- Veranstaltungsparameter und Planzeiten,
- Gates, Ressourcengruppen und Produkte,
- aktive Flugzeugzuordnungen,
- Piloten-IDs,
- das aktuelle Administrationsgerät.

Nicht übernommen werden Tickets, Ticketgruppen, Warteschlangenpositionen, Umläufe, Flugdaten,
Prognosen, Push-Abonnements und Gerätekopplungen außer dem aktuellen Administrationsgerät. Produkte
starten mit gesperrtem Verkauf; der neue Tag startet in `PREPARATION`.

### Vollständig neu einrichten

Diese Stufe übernimmt nur die neuen Veranstaltungsdaten, grundlegende Zeitparameter und das aktuelle
Administrationsgerät. Gates, Ressourcengruppen, Produkte, Flugzeugzuordnungen, Piloten-IDs und alle
Betriebsdaten beginnen leer.

## 5. Nach dem Neustart

1. Die Anwendung wechselt automatisch zur neuen Veranstaltung.
2. Übernommene oder leere Stammdaten kontrollieren.
3. Benötigte Geräte neu koppeln; Besucher müssen Web-Push für neue Tickets erneut aktivieren.
4. Einen synthetischen Kurztest durchführen.
5. Die alte Veranstaltung nach Kontrolle schließen und anschließend archivieren. Nicht löschen:
   Sie ist die revisionssichere Referenz und kann für Berichte oder Wiederherstellung benötigt
   werden.

## Lokale Entwicklung vollständig zurücksetzen

Nur die lokale Wrangler-Datenbank kann zerstörend neu aufgebaut werden:

```bash
npm run db:reset:local
```

Dieser Befehl ist nicht für Cloudflare-D1 vorgesehen. In Cloudflare immer den sicheren Neustart über
die Administration verwenden.

## Werkszustand für eine vollständige Ersteinrichtung

Unter **Administration → Sicherung & Reset → Werkszustand herstellen** kann ein
Administrationsgerät das gesamte System in den Zustand vor der Ersteinrichtung versetzen. Der
Vorgang löscht alle Veranstaltungen, Stammdaten, Tickets, Umläufe, Prognosen, Audit-Ereignisse,
Gerätekopplungen, Push-Zustellungen und den Bootstrap-Beleg. Danach ist `/setup` wieder zwingend.

Standardmäßig wird unmittelbar vor dem D1-Reset eine portable Sicherung mit dem Grund
`FACTORY_RESET` in R2 abgelegt. Sie ist der Wiederherstellungspunkt, falls der Reset irrtümlich
ausgeführt wurde. Die zusätzliche Option **Auch alle R2-Sicherungen endgültig löschen** leert den
gesamten gebundenen Bucket und darf nur verwendet werden, wenn ausdrücklich keine Wiederherstellung
mehr möglich sein soll.

Der D1-Anteil läuft als atomarer Batch. Ein fehlerhafter Löschschritt rollt den gesamten D1-Reset
zurück. Durable-Object-Speicher und offene WebSockets werden vor dem D1-Commit geleert. Die R2-
Leerung ist wiederholbar; ein technischer Reset-Beleg erlaubt das Fortsetzen, wenn ausschließlich
dieser letzte Schritt unterbrochen wurde. Dieser Beleg enthält keine PIN, keinen Gerätetoken und
keine personenbezogenen Daten.

Nach einem erfolgreichen Reset löscht der Browser Geräteschlüssel und Offline-Snapshots und wechselt
zu `/setup`. Für die neue Ersteinrichtung werden wieder der serverseitig konfigurierte Setup-Code und
die Administrator-PIN benötigt.

## Gestörte Administrationsgerätebindung

Zeigt die Administration `Betriebsdaten nicht verfügbar (403)`, ist der Browser nicht als aktuelles
Administrationsgerät bestätigt. Die Seite blendet deshalb weder Reset noch den Hinweis zum
Bearbeitungsmodus aus: Unter **Sicherung & Reset** bleiben alle Stufen sichtbar, ihre Aktionen aber
bis zur Bestätigung gesperrt. **Gerätebindung erneut prüfen** startet die Prüfung erneut.

Bei einem mit einer älteren Version angelegten sicheren Neustart kann die Anwendung einen noch lokal
vorhandenen anonymen Admin-Gerätetoken automatisch der neuen Geräte-ID zuordnen. Der Token wird nur
an denselben Worker gesendet, nie angezeigt oder geloggt und erst nach bestätigter Admin-Rolle
übernommen. Fehlt der Token vollständig, muss das Gerät über ein anderes Administrationsgerät neu
gekoppelt werden; die Administrator-PIN allein ersetzt keine Geräteberechtigung.
