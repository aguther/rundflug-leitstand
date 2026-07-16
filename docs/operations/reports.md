# Historie und Exporte

Die administrative Historie liest ausschließlich das unveränderliche `operational_events`-Ledger.
Sie kann nach Zeitraum, Ereignistyp, Bezugsart und Bezugs-ID gefiltert werden. Es werden höchstens
1.000 Einträge je Anfrage ausgeliefert.

Der CSV-Tagesbericht enthält klar getrennte Abschnitte für Tageskennzahlen, Ticket-Zählbericht,
Flüge, Prognoseentwicklung und besondere Ereignisse. Er weist Passagierzahlen, Kapazität und
Auslastung, gemessene Boarding-, Flug-, Boden-, Umlauf- und Wartezeiten sowie die absoluten
Abweichungen der Boarding-, Start- und Abschlussprognosen aus. Verkäufe und Stornos werden nach
Produkt gruppiert. Zahlart, Zahlstatus und Zahlungsbeträge werden nicht geführt oder exportiert.

Der ticketgenaue Rohdatenexport enthält interne IDs, Produkt, Ressourcengruppe, Slotnummer, Umlauf,
Flugzeug und anonymen Pilotencode. Öffentliche Ticketcodes, Zugangsschlüssel, PINs, Namen und
Telefonnummern werden nicht exportiert.

Der PDF-Tagesbericht ist eine kompakte, archivfähige Zusammenfassung derselben bestätigten
Kennzahlen. CSV- und PDF-Antworten werden bei jedem Abruf aus der relationalen Source of Truth und
dem append-only Ereignisledger erzeugt, nicht zwischengespeichert und erfordern ein berechtigtes,
gekoppeltes Gerät.

Die geschützte Prognosehistorie verknüpft jeden Snapshot mit seinen später bestätigten Ist-Zeiten.
Sie zeigt Datengrundlage, Stichprobengröße, Datenalter, aktive Kapazität, Referenzdauer und den
auslösenden fachlichen Ereignistyp. Die Abweichung wird in Minuten für Boarding, Start, Landung und
Abschluss ausgewiesen. Kassenrollen erhalten keinen Zugriff.
