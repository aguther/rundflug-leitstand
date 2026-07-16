# Freigegebenes UI-Konzept: vereinfachter V1-Betrieb

- Status: Freigegeben
- Datum: 2026-07-16
- Historische Referenz: `docs/ui/v1-simplified-operations-approved.png`
- Status: Durch `docs/ui/operations-v2-multi-surface-concept.md` und dessen sechs freigegebene
  Referenzbilder ersetzt; nicht mehr als visuelle Abnahmevorlage verwenden.
- Bedingung der Freigabe: Kasse, Flight Line und Administration sind drei unabhängige Routen und
  werden niemals gleichzeitig nebeneinander dargestellt. Das Referenzbild ist ausschließlich ein
  Vergleichsboard.

## Gestaltungsgrundlagen

- Dunkles Navy als Seitenhintergrund, Slate-Flächen, nahezu weißer Haupttext, gedämpftes Blau für
  Sekundärtext, kräftiges Blau für die eine Hauptaktion und semantische Farben nur für echte Zustände.
- Keine Gradienten, kaum Schatten, Radien von 4 bis 8 Pixeln und kompakte Abstände.
- Tabellen, Listen und offene Arbeitsflächen statt verschachtelter Karten.
- Eingaben und echte Aktionen bilden die Tab-Reihenfolge. Informationssymbole sind nicht separat
  fokussierbar; ihre Beschreibung wird dem zugehörigen Eingabefeld über `aria-describedby`
  zugeordnet.
- Desktop nutzt Listen-/Detailaufteilungen. Mobile Ansichten zeigen Liste und Bearbeitung nacheinander
  als eigenständige Vollbildzustände.

## Kasse `/`

Der Standardverkauf bleibt vollständig auf einem Bildschirm:

1. kompaktes Produkt auswählen,
2. Gruppengröße festlegen,
3. nur produktabhängig erforderliche Zusatzangaben erfassen,
4. Zusammenfassung prüfen,
5. mit genau einer Hauptaktion verkaufen.

Ein Produkt zeigt kompakt Wartezeit, Verfügbarkeit und realistisch verbleibende Kapazität. Passt eine
Gruppe nur in einen Teil der Flotte, erscheint ein Hinweis auf die voraussichtlich längere Wartezeit.
Eine Teilungswarnung erscheint ausschließlich, wenn kein aktives kompatibles Flugzeug die Gruppe als
Ganzes aufnehmen kann. Zahlungsstatus und Zahlart werden nicht erfasst. Suche, Storno und Umbuchung
liegen hinter der klar getrennten Sekundäraktion „Bestehenden Verkauf bearbeiten“.

## Flight Line `/flight-line`

Das Flugzeug ist das primäre Arbeitsobjekt. Die Flottenliste zeigt Kennung, Passagierkapazität und
aktuellen Zustand. Die Detailfläche des gewählten Flugzeugs zeigt die vorgeschlagene nächste
Fluggruppe, Gate und Zeitfenster. Der aktuelle Pilotencode ist eine unterstützende Information; ein
Wechsel ist eine sekundäre Abweichungsaktion.

Der unveränderte Standardumlauf bleibt bei den vier Primäraktionen `NEXT`, `IM FLUG`, `GELANDET` und
`VERFÜGBAR`. Die Queue wird kompakt und flugzeugbezogen dargestellt. Sonderfälle bleiben getrennt
und dürfen den Standardpfad nicht dominieren.

## Administration `/admin`

Die Hauptnavigation trennt `Übersicht`, `Einrichtung`, `Stammdaten`, `Auswertung` und
`Sicherung & Reset`. Ein eigener Administrationsbereich „Betrieb“ entfällt: die laufende
Flottensteuerung liegt im Flight-Line-Supervisor. Unter „Auswertung“ bleiben Historie,
Tagesberichte und seltene, ausdrücklich administrative Sonderfälle erreichbar.

Die Stammdatenbereiche sind Gates, Ressourcengruppen, Flugzeuge, Pilotencodes und Produkte. Ein
separater Bereich „Zuordnungen“ entfällt; konkrete Flugzeuge werden direkt in der Ressourcengruppe
ausgewählt. Die Liste bleibt sichtbar, während der Editor daneben arbeitet.

Ressourcengruppen erfassen keine manuelle Kapazität und keine Freitextliste kompatibler Typen. Eine
abgeleitete Zusammenfassung zeigt Anzahl der aktiven Flugzeuge, Kapazitätsspanne und größte ohne
Teilung transportierbare Gruppe. Gates bestehen in V1 aus Bezeichnung und der Entscheidung, ob der
Ort öffentlich angezeigt wird.

Der Bearbeitungsmodus besteht aus einem kompakten Zustand und einer Sperren-Aktion. Ein globales
Begründungsfeld entfällt. Begründungen werden nur für irreversible oder außergewöhnliche Eingriffe
verlangt. Irreversible Aktionen verwenden einen einzelnen Bestätigungsdialog, der mit Maus, Touch und
Tastatur nachgewiesen funktionieren muss.

## Sichtbare Kerntexte

- Kasse: „Produkt wählen“, „Gruppengröße“, „Passendes Flugzeug voraussichtlich später verfügbar“,
  „Zusammenfassung“, „Tickets verkaufen“, „Bestehenden Verkauf bearbeiten“.
- Flight Line: Flugzeugkennung mit Plätzen und Zustand, „Vorgeschlagene nächste Gruppe“, „Pilot“,
  „NEXT · Gruppe aufrufen“, „Pilot ändern“, „Warteschlange“ und die vier Primäraktionen.
- Administration: „Bearbeiten aktiv“, „Sperren“, die fünf Stammdatenbereiche,
  „Ressourcengruppe bearbeiten“, „Flugzeuge“, „Zusammenfassung (abgeleitet)“, „Speichern“ und
  „Änderungen verwerfen“.

## Responsive Grenzen

- Desktop ab 1.100 Pixeln: zweispaltige Listen-/Detailansicht.
- Tablet von 700 bis 1.099 Pixeln: kompaktere Spalten, Arbeitsdetails unter der Auswahl, keine
  horizontale Seitenüberläufe.
- Mobil unter 700 Pixeln: jeweils nur eine Aufgabe im Vordergrund; Hauptaktion bleibt am unteren Rand
  sichtbar, ohne Inhalte zu verdecken.
