# ADR-0014: Explizite Komposition vollständiger Buchungsgruppen

- Status: Akzeptiert
- Datum: 2026-07-18
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: V15-QUE-010, V15-QUE-020, F-KAS-020, F-DIS-030

## Kontext

Das implizite Zusammenfassen kleiner Verkäufe machte Gruppen unsichtbar und verband die stabile
Kommunikationskennung mit einem vorläufigen Umlauf. Dadurch wurden Korrekturen, Kapazitätsprüfung und
gleichzeitige Disposition unnötig fragil.

## Entscheidung

Jeder Verkauf erzeugt genau eine sichtbare Buchungsgruppe mit stabiler Kommunikationsnummer. Ein
Aufruf enthält `ticketGroupIds[]`. Der Veranstaltungskoordinator prüft in derselben serialisierten
Kommandogrenze, dass jede Gruppe noch verfügbar, vollständig, derselben Ressourcengruppe zugeordnet
und zusammen mit den anderen Gruppen innerhalb der konkreten Flugzeugkapazität liegt. Erst danach
werden Gruppen in einen Umlauf verschoben. Quellumlaufentwürfe werden geschlossen; die
Gruppenkennungen ändern sich nicht.

## Folgen

Kombinationen wie 2+1 oder 1+1+1 sind ausdrücklich möglich, automatische Gruppenteilung und
stille Zusammenfassung jedoch nicht. Audit, Idempotenzbeleg, Zustand und Outbox werden gemeinsam
persistiert; konkurrierende Auswahl derselben Gruppe kann nur einmal erfolgreich sein.
