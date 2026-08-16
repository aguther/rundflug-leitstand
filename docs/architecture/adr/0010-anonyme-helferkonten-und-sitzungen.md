# ADR-0010: Anonyme Helferkonten und serverseitige Sitzungen

- Status: Teilweise ersetzt durch ADR-0021 sowie V15-AUTH-010 und V173-SES-010
- Datum: 2026-07-17
- Entscheidung: Auftraggeber
- Teilweise ersetzt durch: V15-AUTH-010, V173-SES-010 und
  [ADR-0021](0021-display-konten-und-fids-einstellungen.md)
- Betroffene Anforderungen: F-ADM-030, F-ADM-050, F-ADM-110 bis F-ADM-130, D-080, D-085,
  Q-SIC-020, Q-SIC-050, V15-AUTH-010 und V173-SES-010

## Kontext

Die bisherige Gerätebindung mit gemeinsamem Administrator-PIN ist im Feld schwer verständlich und
verknüpft Berechtigung, Browsergerät und Arbeitsrolle zu eng. Helfer sollen sich ohne Namen oder
freie, zu merkende Benutzernamen anmelden können. Gleichzeitig müssen Schreibaktionen weiterhin
eindeutig, rollenberechtigt, widerrufbar und auditierbar bleiben.

## Entscheidung

- Das System verwaltet ausschließlich pseudonyme Helferkonten ohne Namen, E-Mail oder Telefonnummer.
- Ein Konto besitzt eine zufällige unveränderliche ID und einen sichtbaren Code aus Rolle und
  laufender Nummer, beispielsweise `ADMIN-01`, `KASSE-01`, `FL-01`, `SUP-01` oder `DISPLAY-01`.
- Die Anmeldung zeigt aktive Konten gruppiert nach Rolle. Nach Auswahl wird eine mindestens
  sechsstellige numerische PIN eingegeben.
- Rollen werden serverseitig gespeichert und niemals aus dem sichtbaren Kontocode abgeleitet.
- PINs werden langsam und gesalzen gehasht. Fehlversuche werden pro Konto und Herkunft begrenzt;
  Antworten unterscheiden nicht zwischen unbekanntem Konto und falscher PIN.
- Erfolgreiche Anmeldung erzeugt eine zufällige, nur gehasht gespeicherte Sitzung. Der Browser
  erhält ausschließlich ein `Secure`, `HttpOnly`, `SameSite=Strict` Cookie.
- Die ursprüngliche Laufzeitentscheidung von 30 Minuten Inaktivität und höchstens zwölf Stunden gilt
  nicht mehr. Sitzungen aller Rollen außer `DISPLAY` laufen absolut 16 Stunden ohne früheren
  Idle-Ablauf. `DISPLAY`-Sitzungen laufen absolut 90 Tage ohne früheren Idle-Ablauf. Abmeldung,
  Kontodeaktivierung, PIN-Wechsel und expliziter Sitzungswiderruf wirken für alle Rollen sofort.
- Schreibkommandos protokollieren Konto, Sitzung und Gerät. Die Geräte-ID ist technische Herkunft,
  nicht Benutzeridentität.
- Der zuletzt ausgewählte Kontocode darf lokal als Bedienhilfe gespeichert werden. PIN und
  Sitzungstoken dürfen weder in Web Storage noch in Logs erscheinen.
- QR-Ticketstatus und öffentliche FIDS-Daten bleiben ohne Anmeldung erreichbar. Displayverwaltung,
  Einrichtung und alle internen Oberflächen benötigen eine passende Sitzung.
- Der einmalige Bootstrap-Code dient nur zur Erzeugung des ersten Administratorkontos. Er ist acht
  zufällige alphanumerische Zeichen lang, einmalig verwendbar und ersetzt keine Benutzer-PIN.

## Folgen

Die Tabellen für Geräte bleiben für Herkunft und Betriebsdiagnose erhalten. Ergänzt werden Konten,
Rollen, Sitzungen und Anmeldeversuche. Die bisherigen Geräte-Header werden während der Migration
serverseitig durch die Sitzungskontexte ersetzt. Bestehende fachliche Rollen und Audit-Invarianten
bleiben erhalten.

Die Konto-, Rollen-, Cookie-, Hashing-, Geräte- und Widerrufsentscheidung dieses ADR bleibt gültig.
Nur die ursprünglichen Sitzungsfristen wurden durch V15-AUTH-010 und V173-SES-010 sowie die
Display-Ausgestaltung in ADR-0021 ersetzt. Für die Laufzeitdetails konkretisieren diese neueren
Anforderungen die allgemeine Inaktivitätsformulierung aus Q-SIC-050.
