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
5. Für Web-Push die drei VAPID-Werte einrichten. Ohne diese Werte funktioniert der Leitstand, aber
   Browser-Benachrichtigungen werden nicht zugestellt.
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
