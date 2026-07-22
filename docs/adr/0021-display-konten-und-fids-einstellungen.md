# ADR-0021: Display-Konten und kontobezogene FIDS-Einstellungen

## Status

Freigegeben, Release 1.7.3.

## Kontext

Die frühere FIDS-Webanwendung war anonym erreichbar und bot ein deutsches Standard- sowie ein
englisches Terminalprofil. Damit ließen sich lokale Einstellungen nicht sicher einem Display
zuordnen und die FIDS-Oberfläche war aus operativen Konten erreichbar. Der Auftraggeber hat ein
einheitliches, responsives Standardprofil und langlebige pseudonyme Display-Konten freigegeben.

## Entscheidung

- `DISPLAY` ist eine reine Anzeigerolle. Ihre einzige Start- und Zielansicht ist `/fids`; alle
  übrigen geschützten Event-APIs und App-Ziele lehnen diese Rolle ab. Andere Rollen erhalten keinen
  Zugriff auf FIDS.
- Display-Sitzungen laufen absolut 90 Tage. Sie verwenden denselben sofortigen Widerrufsmechanismus
  wie alle Konten. Die Laufzeit der übrigen Rollen bleibt 16 Stunden.
- Public Board und Logo bleiben anonym lesbar, damit bestehende Besucherintegrationen kompatibel
  bleiben. Geschützt sind die FIDS-Webanwendung und ihre Präferenzen.
- Präferenzen sind pro Operator-Konto und Veranstaltung versioniert. Alle Schreibwerte stammen aus
  dem validierten Body, alle Identitätswerte ausschließlich aus der HttpOnly-Sitzung.
- Der eventbezogene Durable Object serialisiert Updates. D1 speichert Präferenz, Auditereignis,
  Idempotenzbeleg und eine ausschließlich die Version enthaltende Outbox-Meldung atomar.
- Das Terminalprofil wird entfernt. Alte Terminalpfade und Queryparameter werden clientseitig auf
  die Standardansicht normalisiert.

## Folgen

Displaygeräte müssen einmalig mit einem administrativ angelegten Konto angemeldet werden. Die
lange Sitzung minimiert den Betriebsaufwand, während Deaktivierung, PIN-Wechsel, Abmeldung und
Sitzungswiderruf unmittelbar greifen. Portable Backups bleiben frei von Konten, Sitzungen und
Anzeigepräferenzen; eine vollständige Wiederherstellung dieser Daten erfolgt über D1 Time Travel.
