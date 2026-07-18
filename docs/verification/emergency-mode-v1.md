# Verifikation V1-Notfallmodus

Stand: 12.07.2026

Der reproduzierbare Befehl `npm run test:emergency-mode` setzt ausschließlich synthetische lokale
Daten auf und prüft den organisatorischen Notfallmodus über HTTP, Worker, Event-Durable-Object und
D1.

Geprüft werden:

- Auslösung durch ein gekoppeltes Gerät mit der Rolle `FLIGHT_DIRECTOR`,
- sofortige und versionsstabile Sperre weiterer Verkäufe und Aufrufe,
- neutrale öffentliche FIDS-Antwort ohne Gruppen,
- neutraler individueller Ticketstatus `SERVICE_PAUSED` ohne Queue-Position, Wartezeit oder Aufruf,
- unveränderte Fortführung eines bereits gestarteten Umlaufs über `GELANDET` bis `ABGESCHLOSSEN`,
- Ablehnung der Aufhebung durch eine nicht berechtigte Rolle,
- Ablehnung einer falschen Administrator-PIN ohne Versionsänderung,
- erfolgreiche Aufhebung durch Administrator mit korrekter PIN,
- append-only Ereignisse für Auslösung und Aufhebung mit Zeit, Gerät und Grund.

Ergebnis am 12.07.2026: alle Sperren und Neutralisierungen bestätigt, der laufende Flug vollständig
abgeschlossen, Rollen- und PIN-Schutz bestätigt, beide Notfallereignisse im Ledger vorhanden und
finale Event-Version 10.

## Browserprüfung

Die gekoppelte Flight-Line-Leiter-Ansicht wurde unter `http://127.0.0.1:5173/flight-line` geprüft.
Der Not-Halt ist mit genau zwei Interaktionen ausführbar: Grund eingeben und `Not-Halt auslösen`.
Danach erscheint der rote globale Notfallhinweis, die Auslösesteuerung verschwindet und es treten
weder im Desktop- noch im mobilen Layout relevante Konsolenwarnungen oder Darstellungsfehler auf.
