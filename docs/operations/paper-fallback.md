# Papier-Rückfallebene

Bei längerem Totalausfall werden keine unbestätigten digitalen Zustände als verbindlich angenommen.

1. Verkaufsstopp oder Wechsel auf nummerierten Ticketblock gemäß Einsatzleitung.
2. Pro Ressourcengruppe eine handschriftliche Queue mit Gruppenbindung führen.
3. Flugzeug, Pilot, Aufruf, Start, Landung und Abschluss je Umlauf dokumentieren.
4. Keine Gruppe ohne ausdrückliche Entscheidung trennen.
5. Zeitpunkt des Systemausfalls und der Wiederaufnahme dokumentieren.
6. Nach Wiederanlauf Papierdaten über den Nacherfassungsablauf vorsimulieren und erst danach als
   gekennzeichnete Ereignisse nachpflegen.
7. Zwei-Personen-Abgleich von Ticketanzahl, Flügen und Zahlungssummen.

## Belegregeln

- Jeder Papierverkauf erhält eine eindeutige, nicht personenbezogene Belegreferenz und fortlaufende
  Belegnummer.
- Erfasst werden ausschließlich ursprünglicher Zeitpunkt, Belegfolge, Produkt, kontrollierte
  Ticketcodes und rein informatorische Zahlungsangaben. Namen und Telefonnummern bleiben verboten.
- Umlaufereignisse beziehen sich auf dieselbe Belegreferenz und werden als Aufruf, `IM FLUG`,
  `GELANDET` und `ABGESCHLOSSEN` dokumentiert.
- Kasse erfasst Papierverkäufe; Leiter Flight Line oder Administration erfasst Umlaufereignisse.

## Wiedereinpflege nach Wiederanlauf

1. Ein Nacherfassungsbatch wird gegen die aktuelle Event-Version angelegt.
2. Das System sortiert nach ursprünglicher Ereigniszeit, bei Gleichstand nach Papier-Belegfolge.
3. Vor jeder Wirkung simuliert das System Dubletten, unbekannte Belegreferenzen, Zukunftszeiten und
   unmögliche Zustandsfolgen. Konflikte werden einzeln angezeigt und niemals automatisch vereinigt.
4. Ein konfliktfreier Batch wird durch ein anderes Administratorgerät mit PIN freigegeben
   (Vier-Augen-Prinzip).
5. Bei einer inzwischen geänderten Event-Version wird die Freigabe als stale abgelehnt und eine neue
   Simulation verlangt.
6. Angewendete Ereignisse tragen `recordedAfterOutage`, ursprüngliche Zeit, Batch-ID,
   Nacherfassergerät und anonyme Papier-Belegreferenz im append-only Ledger.
7. Abschließend werden Ticketanzahl, Umläufe und Zahlungssummen gegen die Papierlisten abgeglichen.

Die Fachsimulation und das persistente Batch-/Belegmodell sind implementiert. Rollenprüfung,
Vier-Augen-Freigabe und Anwendung auf den Livezustand werden im unmittelbar folgenden Arbeitsschritt
ergänzt. Die laminierfähige Ein-Seiten-Anweisung wird in der Generalprobe mit der realen Hardware
abgenommen.
