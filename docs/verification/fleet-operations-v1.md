# Verifikation Flotte, Pilotencodes und Blockierungen V1

`npm run test:fleet-operations` führt mit synthetischen Daten einen vollständigen Flottenablauf aus:

- Ein anonymer, veranstaltungsbezogener Pilotencode wird mit optionaler organisatorischer Bemerkung
  angelegt; Namen, Lizenz- oder Dokumentdaten sind weder im Kommando noch im operativen DTO enthalten.
- Nach `NEXT` zeigt der Pilotencode seine aktuelle Fluggruppen-/Umlaufzuordnung. Eine Pause während
  des aktiven Umlaufs wird technisch abgelehnt.
- Nach Abschluss kann die Pilotenpause mit Grund und Prüfzeitpunkt gestartet und wieder aufgehoben
  werden; die aktuelle Umlaufzuordnung ist anschließend leer.
- Am Flugzeug sind aktuelle Ressourcengruppe und Queue sichtbar. Eine Flugzeugpause sperrt den
  Aufruf und berechnet den abhängigen Umlauf automatisch als unsicher neu.
- Beginn, Geltungsbereich, Grund, Prüfzeitpunkt und Aufhebung der Blockierung sind im Zustand und
  Auditverlauf nachweisbar.
- Tankvormerkung und organisatorische Erinnerungsschwelle erscheinen im bestätigten Flottenzustand.
- Unterschiedliche Sitzplatzkapazitäten innerhalb derselben Ressourcengruppe bleiben zulässig. Der
  Kapazitäts-/Pilotkonflikttest weist nach, dass für eine Vierergruppe das früheste passende
  Vier-Sitz-Flugzeug vorgeschlagen und ein ebenfalls zugeordnetes Zwei-Sitz-Flugzeug weder
  vorgeschlagen noch bei `NEXT` akzeptiert wird.

Der Referenzlauf endete konsistent mit Veranstaltungsversion 14. Die Daten sind organisatorische
Hinweise und besitzen ausdrücklich keine Sicherheits- oder Freigabewirkung.

Die Browserprüfung erfolgte in der gekoppelten Administration auf Desktop und 430 × 900 Pixeln. Der
Pilotencode `P-99`, seine organisatorische Bemerkung, die leere aktuelle Zuordnung, Flugzeug-Queue und
Tankvormerkung waren sichtbar. Die Pilotenpause ließ sich ohne Navigation starten und wurde sofort als
„Pause“ mit der Aktion „Pause beenden“ dargestellt. Beide Browserkonsolen blieben ohne Fehler und
Warnungen.
