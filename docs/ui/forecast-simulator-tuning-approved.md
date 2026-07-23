# Prognose-Simulator – Admin-Parameter und Tuning-Labor

Stand: 23. Juli 2026
Status: durch den Implementierungsauftrag des Auftraggebers freigegeben

## Ziel und Struktur

Der rechte Szenarioeditor erweitert das bestehende freigegebene Simulator-Konzept um drei klar
getrennte Register:

1. `Betrieb` zeigt ausschließlich tatsächlich prognoserelevante Admin-Planwerte, Flottenparameter,
   Pilotenkapazität sowie die Voraufruf-Aktivierung für Veranstaltung und Ressourcengruppe.
2. `Simulierte Realität` enthält Nachfrage, reale Dreiecksverteilungen und synthetische
   Betriebsereignisse. Diese Werte verändern nicht verdeckt die Admin-Planwerte.
3. `Prognose-Labor` stellt unveränderliche Produktionswerte und lokal editierbare Kandidatenwerte
   nebeneinander. Jeder Kandidat kann einzeln oder vollständig zurückgesetzt werden.

Jeder Bereich trägt die sichtbare Kennzeichnung `Admin`, `Simulation` oder `Experiment`.
Experimentelle Werte besitzen keine Wirkung auf Worker, D1 oder produktive Veranstaltungen.

## A/B-Vergleich

Die Hauptansicht ergänzt die Aktion `Baseline und Kandidat vergleichen`. Ein breiter Dialog zeigt
Fortschritt, Abbruch und anschließend Baseline, Kandidat und Delta je Kennzahl. Standardmäßig werden
25 aufeinanderfolgende Seeds verglichen; 5 bis 100 Läufe sind zulässig. Beide Seiten verwenden
dieselben Admin-, Realitäts- und Störparameter. Nur die technischen Prognose- und
Voraufrufprofile unterscheiden sich.

Die Darstellung spricht keine automatische Empfehlung aus. Fehler, Bias, Fensterbreite,
Qualitätsverteilung und Gate-Wartezeit bleiben getrennte Zielgrößen. Die Berechnung läuft in einem
lokalen Browser-Worker und erzeugt keine Netzwerkzugriffe.

## Admin-Bereinigung

Gemäß ADR-0012 bleiben produktiv nur die Aktivierungen des automatischen Voraufrufs sichtbar.
Die fachlich veralteten Eingabefelder für festen Vorlauf, maximale Gate-Wartezeit,
Mindest-Prognosequalität und Gate-Sperrzeit entfallen aus der Admin-Oberfläche. Ihre bestehenden
D1-Werte werden aus Kompatibilitätsgründen beim Speichern unverändert weitergereicht.

## Abnahme

- Der Seiteneditor bleibt bei 1536 × 1024 und 1280 × 800 vollständig innerhalb des Viewports.
- Tabellen und Register erzeugen keinen horizontalen Dokumentüberlauf.
- Light und Dark Mode verwenden ausschließlich bestehende Design-Tokens.
- A/B-Fortschritt und Abbruch reagieren, ohne Wiedergabe oder Navigation zu blockieren.
- CSV-Kalibrierung verändert nur `Simulierte Realität`.
- Exportformat `rundflug-forecast-simulation/v4` enthält getrennte Admin-, Realitäts-,
  Tuning- und Vergleichsdaten.
