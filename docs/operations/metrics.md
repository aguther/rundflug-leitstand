# Definition der V1-Betriebskennzahlen

Alle Zeiten werden ausschließlich aus bestätigten Ist-Ereignissen berechnet. Fehlende Endereignisse
gehen nicht als Nullwert in einen Durchschnitt ein.

| Kennzahl | Start | Ende |
| --- | --- | --- |
| Wartezeit | Verkauf der Ticketgruppe | `NEXT` / Aufruf |
| Boardingdauer | `NEXT` / Aufruf | `IM FLUG` |
| Flugzeit | `IM FLUG` | `GELANDET` |
| Bodenzeit | `GELANDET` | `ABGESCHLOSSEN/VERFÜGBAR` |
| Umlaufzeit | `NEXT` / Aufruf | `ABGESCHLOSSEN/VERFÜGBAR` |

Der Produktpreis ist reine Produktinformation. Umsatz, Zahlart und Bezahlstatus sind keine
Betriebskennzahlen des Rundflug-Leitstands. „Geräte online“ bedeutet einen bestätigten Kontakt
innerhalb der letzten zwei Minuten. Aktive Web-Push-Abonnements sind eingewilligt, nicht widerrufen
und noch nicht abgelaufen.
