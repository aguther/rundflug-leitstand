# Verifikation: Umlaufzeit-Hierarchie V1.11

- Migration 0056 verankert produktreine Fluggruppen und schützt aktive Ticketzuweisungen per
  Datenbank-Trigger.
- Migration 0057 ergänzt partielle Produkt- und Flugzeug+Produkt-Overrides.
- Migration 0058 persistiert Prognoseannahmen, bestätigte Profile und Snapshotquellen.
- Der reine Domainresolver testet Veranstaltung, partielle Produktwerte und partielle
  Flugzeugausnahmen je Phase.
- `CALL_NEXT` lehnt Mischprodukte ab, verlangt für produktübergreifende FIFO-Abweichungen einen
  Grund und friert das bestätigte Profil ein.
- `test:master-data`, `test:fleet-operations`, `test:queue-grouping` und
  `test:automatic-precall` prüfen Migration, Stammdaten, Zuweisung und Prognose im lokalen D1.
- Master-Data V2, Simulationsplan V3, Clone, Backup, Eventlöschung und Factory Reset führen die
  neue Tabelle und die neuen Felder mit.
