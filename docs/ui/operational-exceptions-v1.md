# Bedienkonzept operative Sonderfälle V1

Status: **zur fachlichen und visuellen Freigabe**

Betroffene Anforderungen: F-SLT-020, F-SLT-040, F-SLT-050, F-SLT-060, F-BRD-080,
F-BRD-085, Q-UX-010, Q-UX-020, Q-UX-030 und Q-UX-040.

## Zielbild

Kasse und Flight Line bleiben Ein-Bildschirm-Arbeitsplätze. Sonderfälle werden direkt am
betroffenen Verkauf beziehungsweise Umlauf bearbeitet; es entsteht kein zusätzliches Menü und kein
Karten-Dashboard. Die Oberfläche verwendet das freigegebene V3-System mit kompakten Tabellen,
ruhigen Flächen, 6–8 Pixel Radius, semantischen Theme-Farben und genau einer hervorgehobenen
Primäraktion je Kontext.

Auf Desktop öffnet sich die Bearbeitung als schmale rechte Kontextspalte. Auf Tablet und Mobil wird
dieselbe Komponente als Bottom-Sheet dargestellt. Liste, Auswahl und Bearbeitung verändern ihre
Position nicht aufgrund unterschiedlicher Eintragszahlen.

## 1. Kasse: große Gruppe bewusst aufteilen

Der Standardverkauf bleibt unverändert. Erst wenn die Gruppengröße die Referenzkapazität eines
Umlaufs überschreitet, erscheint direkt unter dem Mengenzähler ein kompakter Hinweis.

```text
┌ Gruppengröße ──────────────────────────────────────────────┐
│       [ − ]                 7                 [ + ]        │
│                                                            │
│  Aufteilung erforderlich                                   │
│  7 Tickets passen nicht gemeinsam in einen Umlauf mit      │
│  4 Plätzen. Vorgesehen: 4 + 3 in zwei aufeinanderfolgenden │
│  Fluggruppen.                                              │
│                                                            │
│  [ Aufteilung verstanden ]                                 │
│                                     [ 7 Tickets erstellen ]│
└────────────────────────────────────────────────────────────┘
```

- Die Aktion bleibt bis zur einmaligen Bestätigung deaktiviert und nennt sichtbar den Grund.
- Es gibt keinen modalen Dialog. Die Bestätigung gehört zum Verkaufskontext und wird mit dem
  bestehenden Verkaufskommando atomar übertragen.
- Die gemeinsam verkaufte Buchungsgruppe bleibt erhalten. Die beiden Fluggruppen werden unmittelbar
  aufeinanderfolgend angelegt und in Kasse sowie Flight Line mit „gemeinsame Gruppe 1/2“ und „2/2“
  gekennzeichnet.
- Bei einer nachträglichen Kapazitätsänderung wird niemals still weiter aufgeteilt.

## 2. Flight Line: kontextbezogene Disposition

Jede Umlaufzeile besitzt neben der normalen Primäraktion eine zurückhaltende Aktion
„Disposition“. Sie öffnet den Kontextbereich für genau diesen Umlauf. Der Bereich zeigt zuerst eine
Auswirkungszusammenfassung; erst darunter folgen zulässige Aktionen.

```text
┌ Laufende Fluggruppen ───────────────────────────────┬ Disposition ───────────────┐
│ PAN20-108  ·  Bereit  ·  4/4     [Aufrufen] [···]   │ PAN20-108 · vor Aufruf      │
│ PAN20-109  ·  Wartet  ·  3/4              [···]    │                             │
│ PAN20-110  ·  Wartet  ·  4/4              [···]    │ Nutzbare Plätze             │
│                                                     │ [ − ]  4  [ + ]             │
│                                                     │ Keine Gruppe betroffen.     │
│                                                     │ [Kapazität übernehmen]      │
│                                                     │ ─────────────────────────── │
│                                                     │ Gruppe verschieben          │
│                                                     │ Ziel [PAN20-109 · 1 Platz ▾]│
│                                                     │ Ganze Gruppe, keine Trennung│
│                                                     │ [Verschiebung übernehmen]   │
└─────────────────────────────────────────────────────┴─────────────────────────────┘
```

### Kapazität vor dem Aufruf reduzieren

- Verfügbar nur im Status `DRAFT` und nur für Flight-Line-Leitung oder Administration.
- Angezeigt werden Ausgangskapazität, neue nutzbare Kapazität und die vollständigen betroffenen
  Buchungsgruppen.
- Passt eine ganze Gruppe nicht mehr, zeigt die Vorschau: „Gruppe G‑… mit 3 Tickets rückt gemeinsam
  an die vorderste passende Position.“
- Die Bestätigung löst genau ein versioniertes Kommando aus. Die Queue wird unter Wahrung der
  Gruppenbindung neu sortiert und auditiert.
- Eine Kapazitätsangabe ist rein organisatorisch und besitzt keinerlei Sicherheits- oder
  Freigabewirkung.

### Ganze Gruppe manuell verschieben

- Auswahlziele zeigen Fluggruppenkennung, freien Platz und Status. Unzulässige Ziele werden nicht
  angeboten.
- Verschoben wird immer die ganze Buchungsgruppe. Ein Ziel mit zu wenig Platz ist deaktiviert und
  erklärt „3 Tickets, aber nur 2 Plätze frei“.
- Bis `IM FLUG` ist eine dokumentierte Änderung möglich; nach `IM FLUG` ist die Besetzung gesperrt.
- Für normale Disposition ist keine Administrator-PIN erforderlich. Eine kurze Begründung wird nur
  bei Abweichung vom Systemvorschlag verlangt, nicht bei jeder Bedienaktion.

## 3. Fehlende Personen nach dem Aufruf

Im Status `CALLED` oder `BOARDING` zeigt der Kontextbereich die anonyme Anwesenheit als Zählwert,
nicht als Personenliste.

```text
┌ Gruppe PAN20-108 · aufgerufen ─────────────────────────────┐
│  Anwesend 3 von 4       Frist noch 02:14                   │
│                                                            │
│  [ Gemeinsam zurückstellen ]                              │
│  [ Mit 3 Personen fliegen ]                               │
│  [ Fehlenden Platz leer lassen ]                          │
│                                                            │
│  Ersatzvorschlag: Gruppe G-184 · 1 Ticket · eingecheckt   │
│  [ Ersatz übernehmen ]                                    │
└────────────────────────────────────────────────────────────┘
```

- Vor Ablauf der No-Show-Frist ist „No-Show“ nicht verfügbar; der Restzeit-Hinweis erklärt warum.
- Nach Fristablauf wird das fehlende Ticket auf No-Show gesetzt. Das System darf nur einen
  passenden, eingecheckten Ersatz vorschlagen; die Entscheidung bleibt beim Personal.
- „Gemeinsam zurückstellen“ löst die gesamte Buchungsgruppe und reiht sie gemeinsam wieder ein.
- „Mit 3 Personen fliegen“ und „Platz leer lassen“ dokumentieren die bewusste Entscheidung, ohne
  automatisch eine andere Gruppe zu verändern.
- „Ersatz übernehmen“ zeigt vor Bestätigung Quelle, Ziel und verbleibende Gruppenbindung. Eine
  Buchungsgruppe wird niemals für einen einzelnen freien Platz automatisch getrennt.
- Nach Ausführung erscheint zehn Sekunden lang eine Rücknahmeleiste, sofern der Umlauf noch nicht
  `IN_FLIGHT` ist. Danach bleibt eine Korrektur nur über den auditierten Sonderfallpfad möglich.

## 4. Administration: Historie und Prognoseauswertung

Die bestehende Auditfläche erhält oberhalb der stabilen Tabelle zwei kompakte Ansichten:
„Betriebshistorie“ und „Prognosegüte“. Die Filter verwenden dieselbe Höhe und Anordnung wie die
Stammdatensuche.

```text
┌ Historie ───────────────────────────────────────────────────────────────┐
│ [Betriebshistorie] [Prognosegüte]                                     │
│ Von [TT.MM.JJJJ] [HH:mm]  Bis [TT.MM.JJJJ] [HH:mm]  Status [Alle ▾]   │
│ Flugzeug [Alle ▾]  Pilotencode [Alle ▾]  Produkt [Alle ▾] [Anwenden]  │
├────────────────────────────────────────────────────────────────────────┤
│ Zeitpunkt │ Fluggruppe │ Ticket/Gruppe │ Status │ Flugzeug │ Pilot    │
│ …                                                                      │
└────────────────────────────────────────────────────────────────────────┘
```

- Deutsches Datum `TT.MM.JJJJ`, Zeit im 24-Stunden-Format `HH:mm`.
- Weitere Filter: Ressourcengruppe, Slotnummer, Ticket-ID, Ticketgruppe und Umlauf.
- Die Prognoseansicht zeigt Snapshotzeit, Auslöser, Qualitätsstufe, Datengrundlage sowie Abweichung
  für Boarding, Start, Landung und Abschluss.
- Filter bleiben beim Ansichtswechsel erhalten. Pagination verändert die Tabellenhöhe nicht.
- IDs sind kopierbar, aber nicht dekorativ dominant. Namen, Telefonnummern und öffentliche
  Ticketcodes erscheinen nicht.

## Zustände und Aktionshierarchie

| Zustand | Primäraktion | Sekundäre Sonderaktionen |
| --- | --- | --- |
| DRAFT | Aufrufen | Kapazität ändern, ganze Gruppe verschieben |
| CALLED | Boarding fortsetzen | Anwesenheitsentscheidung, gemeinsam zurückstellen |
| BOARDING | Flug starten | Anwesenheitsentscheidung, Platz leer lassen |
| IN_FLIGHT | Landung bestätigen | keine Besetzungsänderung |
| LANDED | Umlauf abschließen | keine Besetzungsänderung |
| COMPLETED/CANCELED | keine | nur Historie ansehen |

## Responsive und barrierearme Ausführung

- Touch-Ziele mindestens 44 × 44 Pixel; kritische Primäraktionen mindestens 48 Pixel hoch.
- Fokusreihenfolge folgt Queue → Primäraktion → Kontextbereich. Das Bottom-Sheet erhält einen
  sichtbaren Titel und gibt den Fokus beim Schließen zurück.
- Status besitzt immer Text und Symbol, niemals nur Farbe.
- Hell- und Dunkelmodus verwenden ausschließlich vorhandene semantische Theme-Tokens. Deaktivierte
  Aktionen bleiben lesbar und nennen unmittelbar den Sperrgrund.
- Auf 430 Pixel Breite gibt es kein horizontales Seiten-Scrolling. Tabellen werden zu kompakten
  Zeilen; der Editor nutzt maximal 85 Prozent der Bildschirmhöhe und scrollt intern.
- Bei Live-Aktualisierung bleibt die gewählte Fluggruppe aktiv. Wird ihre Version veraltet, zeigt
  der Kontextbereich den neuen bestätigten Stand und verlangt eine erneute bewusste Aktion.

## Technische und fachliche Abnahmekriterien

1. Jede Änderung verwendet Idempotenz-ID und erwartete Veranstaltungsversion; stale writes werden
   sichtbar abgelehnt.
2. Mutation, Audit-Ereignis, Idempotenzbeleg und Outbox werden fachlich konsistent persistiert.
3. Keine Aktion trennt eine Buchungsgruppe automatisch.
4. Besetzung und nutzbare Kapazität sind ab `IN_FLIGHT` unveränderlich.
5. No-Show und Ersatzentscheidung sind getrennte, nachvollziehbare Ereignisse.
6. Standardabläufe bleiben ohne Navigation und ohne zusätzlichen Bestätigungsdialog bedienbar.
7. Rücknahme ist nur im fachlich reversiblen Zeitfenster möglich und ebenfalls auditiert.
8. Desktop, Tablet und 430-Pixel-Mobilansicht werden in Hell und Dunkel im Browser geprüft.
9. Die Browserkonsole bleibt fehlerfrei; Tastaturbedienung und sichtbarer Fokus werden geprüft.
10. Es werden ausschließlich synthetische, anonyme IDs und Pilotencodes verwendet.
