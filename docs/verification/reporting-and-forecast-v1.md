# Verifikation Tagesbericht und Prognoseauswertung V1

`npm run test:vertical-slice` führt mit synthetischen Daten einen vollständigen Veranstaltungslauf
von Verkauf über Aufruf, Start und Landung bis zum Abschluss aus. Der Lauf verifiziert:

- append-only Prognose-Snapshots nach bestätigten Kommandos,
- auslösenden Ereignistyp sowie Historienbezug, Stichprobengröße, Datenalter, aktive Kapazität und
  Referenzdauer,
- paginierte und rollenbeschränkte Prognosehistorie,
- spätere Verknüpfung der Snapshots mit bestätigten Boarding-, Start-, Lande- und Abschlusszeiten,
- berechnete Prognoseabweichungen für alle vier Phasen,
- vollständigen CSV-Tagesbericht mit Tageskennzahlen, Ticket-Zählbericht je Produkt, Flügen,
  Prognoseentwicklung und besonderen Ereignissen sowie
- kompakten PDF-Tagesbericht aus denselben bestätigten Daten.

Vertrags-, SQL- und Format-Unit-Tests ergänzen den End-to-End-Lauf. Sie prüfen Filterbindung,
Pagination, anonymes Antwortformat, alle geforderten Berichtsabschnitte und die
Append-only-Sicherung. Umgekehrte Zeiträume werden mit `400`, nicht berechtigte Kassenrollen mit
`403` abgewiesen.

Migration `0029_forecast_snapshot_basis.sql` ist rein additiv. Bestehende Snapshots werden als
`LEGACY_UNKNOWN` gekennzeichnet; neue Snapshots besitzen die vollständige Datengrundlage. Vor der
Remote-Migration ist gemäß Betriebsanleitung eine portable Sicherung zu erzeugen.
