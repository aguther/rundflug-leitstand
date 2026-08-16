# ADR-0032: Durchsatz- und fairnessorientierte Dispatch-Planung

- Status: Teilweise ersetzt durch ADR-0036 für die FIDS-Sortierung
- Datum: 2026-08-01
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: F-PRG-020, F-PRG-030, F-BEN-030, F-BEN-090, F-BEN-100,
  V15-QUE-020, Q-ZUV-020

## Kontext und bisheriges Verhalten

Die bisherige Prognose reservierte offene Fluggruppen nacheinander in Queue-Reihenfolge. Der
Vorabruf verwendete daraus ein starres Queue-Präfix. Dadurch blieben Restplätze frei, obwohl mehrere
vollständige, produktkompatible Gruppen gemeinsam gepasst hätten. Eine große Vordergruppe konnte
kleinere passende Gruppen und sogar unabhängige Ressourcengruppen am selben Gate blockieren. Die
Produktmischung, heterogene Flugzeugkapazitäten und mehrere gleichzeitig verfügbare Bahnen wurden
nicht als gemeinsame Dispatch-Entscheidung behandelt.

Das führte außerdem zu einer semantischen Lücke: Prognose, Vorabruf, Flight-Line-Empfehlung und
Simulator konnten verschiedene Reihenfolgen annehmen. Ein Gate wurde implizit als Gruppenanzahl
statt als Sitzinventar behandelt. Die adaptive Vorlaufmessung vermischte organisatorische
Gate-Wartezeit mit der festen Gehzeit zum Gate.

## Entscheidung

### Ein gemeinsamer, reiner Planer

`packages/domain/src/dispatch-plan.ts` ist die einzige fachliche Planungsfunktion für Produktion und
Simulator. Der Algorithmus ist rein, deterministisch, reproduzierbar und durch explizite Grenzen für
Ressourcengruppen, Produkte, Wellen, Kandidaten und Beam-Breite beschränkt. Cloudflare-, D1-, HTTP-
und UI-Abhängigkeiten sind ausgeschlossen.

Der Planer verarbeitet vollständige, atomare Buchungsgruppen. Ein Batch ist produktrein, verwendet
genau eine Ressourcengruppe und genau ein Gate und überschreitet niemals die Sitzkapazität seiner
Flugzeug-/Piloten-Bahn. Mehrere Bahnen und mehrere nahe Wellen werden gemeinsam geplant. Nicht
einplanbare Gruppen erhalten einen expliziten Grund; fehlende Kapazität erzeugt keine künstliche
Nullprognose.

### Lexikografische Zielordnung

Die Bewertung ist fachlich lexikografisch, nicht als frei austauschbare gewichtete Summe:

1. bestehende harte Verpflichtungen (`COME_TO_FLIGHT_LINE`) schützen;
2. Maximalwartezeit und maximale Überholzahl als Must-Serve-Grenzen erfüllen;
3. Produkt-Service-Defizite und drohende Aushungerung reduzieren;
4. beförderte Personen und nahe Sitzplatzauslastung maximieren;
5. Überholungen begrenzen, Alter und Queue-Reihenfolge bevorzugen;
6. den vorherigen Plan stabil halten;
7. bei Gleichstand stabile technische IDs verwenden.

Ein Überholen ist damit eine begrenzte, sichtbare Optimierungsentscheidung und keine Auflösung der
Buchungsgruppe. Eine bereits zu `COME_TO_FLIGHT_LINE` aufgerufene Gruppe bleibt auf ihrer weiterhin
passenden Bahn. Die Wellenordinalzahl darf sich beim Fortschreiten des Plans normalisieren. Nur ein
tatsächlicher Ressourcenverlust oder eine nachweislich nicht mehr passende Kapazität darf diese
Annahme lösen. `PREPARE` ist stärker bindend als `WAITING`, bleibt aber unterhalb von
`COME_TO_FLIGHT_LINE`.

Projizierte und bestätigte Überholungen bleiben getrennt. Der Plan berechnet
`dispatch_projected_overtake_count` ausschließlich als Diagnose seiner aktuellen Reihenfolge; dieser
Wert wird nicht als historische Fairnessschuld in den nächsten Plan zurückgeführt. Erst ein
erfolgreiches `CALL_NEXT` erhöht den bestätigten Überholzähler früherer, zu diesem Zeitpunkt
verfügbarer Rotationen atomar. Damit können Prognosen ihre eigene Priorisierung nicht selbst
verstärken, während tatsächlich wiederholt überholte Gruppen weiterhin zuverlässig die
Must-Serve-Grenze erreichen.

### Prognose, Vorabruf und Gate-Wegvorlauf

Die Prognose reserviert pro Batch genau eine Bahn. Alle Batchmitglieder erhalten dasselbe
Boardingfenster. Der automatische Vorabruf folgt dem Dispatch-Plan und keinem Queue-Präfix. Nahe
Batches dürfen unabhängig von einer nicht passenden Vordergruppe und unabhängig von einer anderen
Ressourcengruppe am selben Gate aufgerufen werden. Die relevante Gate-Belegung wird in Sitzen
ausgedrückt.

Jedes Gate besitzt `travelLeadMinutes` mit Standard `0` und dem gültigen Bereich `0..30`. Der
effektive Vorlauf ist der adaptive Basisvorlauf zuzüglich dieses Wegvorlaufs. Das prognostizierte
Boardingfenster bleibt unverändert. Für Lernwerte wird die verwendete Wegkomponente von der
beobachteten Zeit zwischen `GO TO GATE` und Boarding abgezogen, damit der adaptive Basiswert nicht
nach oben driftet. Basiswert, Wegvorlauf, effektiver Wert, Entscheidungsgrund, Planrevision und Batch
werden historisch gespeichert.

### Bedienung, Konsistenz und Audit

Flight Line und Flight Director wählen die aktuelle optimierte Empfehlung vor. Die Bestätigung
übermittelt Planrevision und Batch-ID. Der Event-Coordinator lehnt veraltete Empfehlungen mit
`DISPATCH_PLAN_STALE` ab und prüft weiterhin erwartete Version, Idempotenz, Rollen und eindeutige
aktive Ticketzuordnung. Eine manuelle Abweichung bleibt möglich, benötigt einen Grund und wird
strukturiert auditiert. Die Empfehlung besitzt keine flugbetriebliche Freigabesemantik; Flugzeug und
Boarding werden weiterhin menschlich bestätigt.

FIDS sortiert `BOARDING`, `COME_TO_FLIGHT_LINE`, `PREPARE`, `WAITING`, danach kürzlich abgeflogene
Gruppen. Innerhalb eines Zustands gelten Dispatch-Reihenfolge, prognostiziertes Boarding,
Queue-Reihenfolge und stabile ID.

## Ersetzung von ADR-0029

Diese ADR ersetzt ausdrücklich die Aussage aus ADR-0029, jede Ressourcengruppe bilde ein
„stabiles, ohne Überholen gebildetes Queue-Präfix“, sowie die Folge „eine nicht passende
Vordergruppe wird nicht durch eine kleinere Folgegruppe überholt“. Fortgeltend bleiben aus ADR-0029
die unabhängige Behandlung von Ressourcengruppen am selben Gate, die kapazitätsbezogene
Prognosebahn, die Trennung von `PREPARE`, `GO TO GATE` und `BOARDING` sowie das Verbot künstlicher
Null-Minuten-Prognosen. Zulässig sind nun ausschließlich die in dieser ADR begrenzten und
diagnostizierten Überholungen.

## Folgen und Nachweise

- Planner- und Forecast-Tests decken Packung, Mehrbahnbetrieb, Produktreinheit, Heterogenität,
  Fairness, Anti-Starvation, Stabilität, Ressourcenverlust und deterministische Begrenzung ab.
- Vorabruf-Tests decken unabhängige Ressourcengruppen am selben Gate, sitzbezogene nahe Batches und
  Wegvorlauf mit normalisiertem Lernwert ab.
- Simulator und Produktion verwenden dieselbe Domainfunktion. Der Simulator weist Durchsatz,
  Flugzeugstunden, angebotene/belegte Sitze, Wartequantile, Produktwerte, Überholungen,
  Serviceanteile, Service-Schulden und Planstabilität aus.
- Synthetische Regressionen trennen bestätigte von projizierten Überholungen und sichern, dass
  wiederholte Prognoseläufe keine selbstverstärkende Fairnessschuld erzeugen.
- Migration `0060_dispatch_planning_and_gate_travel_lead.sql` ist additiv. Vor Anwendung ist eine
  portable Sicherung oder D1-Time-Travel-Marke erforderlich; die Wiederherstellungsnotiz steht in
  der Migration und im Migrationsregister.
