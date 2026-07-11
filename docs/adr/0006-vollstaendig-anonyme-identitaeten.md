# ADR-0006: Vollständig anonyme Identitäten

- Status: Akzeptiert
- Datum: 2026-07-11
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: F-FLT-040, F-ADM-030, Q-DSG-010, Q-DSG-020, Q-DSG-030

## Kontext

Der Auftraggeber hat entschieden, dass das System vollständig anonym arbeitet und keine Namen oder
Telefonnummern erfasst. Die spätere Einzelentscheidung schließt Telefonnummern auch als optionale
Angabe aus; Statusabfrage erfolgt über QR-Code, Webseite beziehungsweise PWA. Web-Push bleibt nach
ausdrücklicher Einwilligung erhalten.

## Entscheidung

- Gäste werden ausschließlich über nicht aufzählbare Ticket-IDs beziehungsweise Ticketcodes geführt.
- Helfer erhalten keine persönlichen Konten; Geräte werden mit technischer Bezeichnung und fester Rolle
  gekoppelt.
- Piloten werden abweichend vom ursprünglichen Wortlaut von F-FLT-040 ausschließlich über ein
  veranstaltungsbezogenes operatives Kürzel geführt. Namen werden nicht gespeichert.
- Telefonnummern werden weder verpflichtend noch optional erfasst.
- Web-Push-Ziele werden getrennt, einwilligungsgebunden und befristet gespeichert.

## Folgen

Ein operatives Kürzel muss vor Ort eindeutig zugeordnet werden, ohne dass diese Zuordnung im
Rundflug-Leitstand gespeichert wird. Gesetzlich oder flugbetrieblich erforderliche personenbezogene
Unterlagen bleiben außerhalb dieses organisatorischen Systems.
