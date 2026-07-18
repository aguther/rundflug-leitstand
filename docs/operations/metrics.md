# Definition der V1-Betriebskennzahlen

Alle Zeiten werden ausschließlich aus bestätigten Ist-Ereignissen berechnet. Fehlende Endereignisse
gehen nicht als Nullwert in einen Durchschnitt ein.

| Kennzahl | Start | Ende |
| --- | --- | --- |
| Wartezeit | Verkauf der Ticketgruppe | bestätigter Boarding-Aufruf (`CALL_NEXT`) |
| Boardingdauer | bestätigter Boarding-Aufruf (`CALL_NEXT`) | `IM FLUG` |
| Flugzeit | `IM FLUG` | `GELANDET` |
| Bodenzeit | `GELANDET` | `ABGESCHLOSSEN/VERFÜGBAR` |
| Umlaufzeit | bestätigter Boarding-Aufruf (`CALL_NEXT`) | `ABGESCHLOSSEN/VERFÜGBAR` |

Der Produktpreis ist reine Produktinformation. Umsatz, Zahlart und Bezahlstatus sind keine
Betriebskennzahlen des Rundflug-Leitstands. „Geräte online“ bedeutet einen bestätigten Kontakt
innerhalb der letzten zwei Minuten. Aktive Web-Push-Abonnements sind eingewilligt, nicht widerrufen
und noch nicht abgelaufen.
