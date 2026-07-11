# Historie und Exporte

Die administrative Historie liest ausschließlich das unveränderliche `operational_events`-Ledger.
Sie kann nach Zeitraum, Ereignistyp, Bezugsart und Bezugs-ID gefiltert werden. Es werden höchstens
1.000 Einträge je Anfrage ausgeliefert.

Der CSV-Tageszählbericht gruppiert Verkäufe und Stornos nach Produkt, Zahlart und Zahlstatus. Beträge
sind ausdrücklich informatorisch. Der ticketgenaue Rohdatenexport enthält interne IDs, Produkt,
Ressourcengruppe, Slotnummer, Umlauf, Flugzeug und anonymen Pilotencode. Öffentliche Ticketcodes,
Zugangsschlüssel, PINs, Namen und Telefonnummern werden nicht exportiert.

Der PDF-Tagesbericht ist eine kompakte, archivfähige Zusammenfassung aus bestätigten Ist-Ereignissen.
CSV- und PDF-Antworten werden nicht zwischengespeichert und erfordern ein berechtigtes, gekoppeltes
Gerät.
