# ADR-0022: Getrennte Buchungs- und Fluggruppenkennungen

- Status: Akzeptiert
- Datum: 2026-07-23
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: F-KAS-090, F-SLT-010, F-SLT-020, F-SLT-100, F-MON-010,
  F-MON-020, F-MON-040, F-BEN-010, V15-QUE-010, V15-FIDS-010, V16-KAS-030,
  V16-TKT-010, V173-FID-010 und V173-QA-010

## Kontext

Die bisherige Darstellung verwendete Produktkürzel und dreistellige Nummern sowohl für die
öffentliche Buchungsgruppe als auch für die operative Fluggruppe. Eine Buchungsgruppe und ihre
Ressourcengruppen-Queue besitzen jedoch unabhängige Nummern. Bei geteilten Buchungen entstehen
zusätzlich mehrere operative Fluggruppen für dieselbe Buchungsgruppe. Gleiche oder ähnlich
konfigurierte Produkt- und Ressourcengruppenkürzel verdeckten diese fachliche Trennung und führten
zu widersprüchlich wirkenden Anzeigen.

## Entscheidung

- Die öffentliche Buchungsgruppenkennung lautet
  `G-<Produktkürzel>-<vierstellige Buchungsnummer>`, beispielsweise `G-RN-0134`.
- Die interne operative Fluggruppenkennung lautet
  `F-<Ressourcengruppenkürzel>-<dreistellige Fluggruppennummer>`, beispielsweise
  `F-RG001-130`.
- Ticketdruck, QR-Ticketstatus und FIDS zeigen ausschließlich die öffentliche G-Kennung.
- Kasse, Flight Line, Administration, operative Historie und Tagesbericht verwenden für Umläufe
  die F-Kennung. Die Liste „Verkaufte Tickets“ zeigt die G-Kennung mit der zugeordneten
  F-Kennung in Klammern; bei einer bewussten Aufteilung bleiben alle F-Kennungen sichtbar.
- Die Ticketsuche akzeptiert die neuen G- und F-Kennungen. Die bisherigen Produkt-/Nummern-Labels
  bleiben als kompatible Sucheingabe erhalten.
- Beide Kennungen werden aus den bereits gespeicherten Kommunikationsnummern abgeleitet. Es gibt
  keine Datenbankmigration, keine Neunummerierung und keine Änderung der Queue-Reihenfolge.
- Die Formatierung liegt als reine Fachfunktion im Domain-Paket. Öffentliche Verträge geben keine
  operative F-Kennung aus.

ADR-0022 konkretisiert und ersetzt die in F-SLT-100 geforderte identische Darstellung auf allen
Ansichten. Stabil und identisch bleibt jeweils die zugrunde liegende Buchungs- beziehungsweise
Fluggruppennummer in ihrem fachlichen Kontext; öffentliche und operative Kommunikation werden
bewusst unterscheidbar.

## Folgen

Bereits verkaufte Tickets erscheinen unmittelbar mit der neuen G-Kennung, bestehende Umläufe mit
der neuen F-Kennung. Ein Rollback benötigt nur die vorherige Anwendungsversion; persistente Daten
werden weder verändert noch entfernt. Die Änderung erzeugt keine Auditereignisse, weil sie keine
operative Zustandsänderung ausführt.
