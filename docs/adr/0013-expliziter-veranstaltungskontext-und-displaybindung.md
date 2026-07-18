# ADR-0013: Expliziter Veranstaltungskontext und Displaybindung

- Status: Akzeptiert
- Datum: 2026-07-18
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: F-MON-030, F-MON-080, F-ADM-080, F-ADM-130, D-070, D-080 und
  Q-ZUV-030

## Kontext

Ein Browser ohne gespeicherten Veranstaltungskontext verwendete bisher stillschweigend den
synthetischen Entwicklungswert `demo-2026`. Dadurch konnte eine gültige Anmeldung wie ein
Serverausfall erscheinen, obwohl lediglich eine nicht vorhandene Veranstaltung abgefragt wurde.
Bei mehreren Veranstaltungen muss außerdem eindeutig sein, welchen Veranstaltungstag ein
Arbeitsplatz beziehungsweise ein öffentlicher Monitor zeigt.

## Entscheidung

- Nach erfolgreicher Konto- und PIN-Prüfung wählt der Bediener bewusst eine nicht archivierte
  Veranstaltung. Auch eine einzelne Veranstaltung wird sichtbar bestätigt.
- Eine gespeicherte oder per URL angeforderte Veranstaltungs-ID wird gegen den serverseitigen,
  sitzungsgeschützten Veranstaltungskatalog geprüft. Unbekannte IDs öffnen die Auswahl und niemals
  einen stillen Ersatzwert.
- Die gewählte Veranstaltung bleibt im Kopfbereich sichtbar. Ein Wechsel ist eine ausdrückliche
  Bedienhandlung und lädt den Arbeitsbereich mit einem neuen Kontext.
- `demo-2026` bleibt ausschließlich ein lokaler Entwicklungs-Fallback.
- Öffentliche FIDS-Inhalte bleiben anonym abrufbar. Ihre Konfiguration und Aktivierung erfolgt über
  die bestehende, administrativ erzeugte QR-Gerätekopplung.
- Eine Displaykopplung enthält genau eine Veranstaltung, optional genau ein Gate und ein Profil
  (`standard` oder `terminal`). Die drei Werte werden als zusammengehörige lokale Gerätebindung
  gespeichert; Gate und Profil werden nie in eine andere Veranstaltung übernommen.
- Ein unkonfiguriertes FIDS zeigt einen eindeutigen Einrichtungshinweis, statt eine Demo- oder
  fremde Veranstaltung zu öffnen.

## Folgen

Bediengeräte können mehrere Veranstaltungen zuverlässig unterscheiden. Fest installierte Anzeigen
starten nach der einmaligen Kopplung ohne tägliche Auswahl in ihrem gebundenen Kontext. Das
Gate-Filtering verwendet weiterhin den serverseitigen Gate-Anzeigefilter und veröffentlicht keine
zusätzlichen internen oder personenbezogenen Daten.
