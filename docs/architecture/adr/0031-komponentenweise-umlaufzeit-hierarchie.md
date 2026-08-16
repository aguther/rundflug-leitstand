# ADR-0031: Komponentenweise Umlaufzeit-Hierarchie und Prognoseannahmen

## Status

Angenommen – Release 1.11.0

## Kontext

ADR-0030 legte die Produktzeit Offblock–Onblock und drei ausschließlich veranstaltungsweite
Bodenphasen fest. Für Veranstaltungen mit unterschiedlichen Produkten und Flugzeugmustern reicht
eine einzige Bodenzeit jedoch nicht aus. Gleichzeitig darf eine Prognoseannahme die flexible
Flugzeugzuordnung vor dem bestätigten Aufruf nicht vorwegnehmen.

## Entscheidung

Die Offblock–Onblock-Referenzzeit bleibt ausschließlich am Produkt. Boarding, Ausstieg und Puffer
werden dagegen je Phase in folgender Reihenfolge aufgelöst:

1. Flugzeug + Produkt,
2. Produkt,
3. Veranstaltung.

`null` bedeutet Vererbung; jede Phase fällt unabhängig auf die nächste Ebene zurück. Der Resolver
liefert neben dem Wert auch Quellenebene und Quell-ID. Die Summe der drei Bodenphasen und der
Produktzeit bleibt eine abgeleitete Referenz-Umlaufzeit.

DRAFT-Umläufe werden je verfügbarem Kandidatenflugzeug berechnet. Die gewählte Lane wird als
Prognoseannahme gespeichert, setzt aber keine operative Flugzeugzuordnung. Erst `CALL_NEXT` bestätigt
das Flugzeug und friert Produkt, drei Phasenwerte und deren Quellen für den laufenden Umlauf ein.
Spätere Konfigurationsänderungen wirken nur auf DRAFT- und Folgeumläufe.

Neue Fluggruppen sind produktrein. Eine gemeinsame Belegung darf nur Ticketgruppen desselben
Produkts enthalten. Die normale Queue bleibt produktübergreifend FIFO; das Überspringen früherer
Gruppen eines anderen Produkts benötigt eine auditierte Begründung.

## Folgen

- Die Aussagen aus ADR-0030, nach denen Bodenphasen ausschließlich veranstaltungsweit seien und
  Flugzeuge keine Prognosezeit-Semantik hätten, sind durch diese Entscheidung ersetzt.
- Quellen werden nur in Administration und interner Planung gezeigt.
- Stammdatenformat V2 und Simulationsplan V3 transportieren partielle Overrides; ältere Formate
  bleiben lesbar.
- Snapshots vor Migration 0058 werden mit `LEGACY_UNKNOWN` als unbekannte Quelle gelesen.
- Ressourcengruppen erhalten weiterhin keine eigene Umlaufzeit.

## Traceability

Die Entscheidung konkretisiert `F-RES-010`, `F-RES-060`, `F-PRG-030`, `F-HIS-070`, `D-015` und
`D-020`, ohne die flugbetriebliche oder sicherheitsrelevante Entscheidungshoheit zu verändern.
