# ADR-0035: Kurzlebige Reservierung von Dispatch-Vorschlägen

- Status: Akzeptiert
- Datum: 2026-08-03
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: F-BRD-010, F-BRD-020, F-SLT-050, F-SLT-120, F-PRG-020,
  F-PRG-030, F-PRG-110, F-INT-070, Q-ZUV-020

## Kontext

Flight Line und Flight Director können parallel eine Belegung vorbereiten. Ein ausschließlich lokal
angezeigter Vorschlag verhindert nicht, dass beide Bedienplätze dieselbe nächste Dispatch-Gruppe
bestätigen wollen. Die bestehende Versionsprüfung weist zwar einen veralteten Schreibversuch ab,
liefert dem zuerst geöffneten Dialog aber keine zeitlich begrenzte operative Priorität. Außerdem darf
die Prognoseempfehlung weiterhin weder eine dauerhafte Flugzeugbindung noch ein automatisches
Boarding bewirken.

## Entscheidung

Beim Öffnen eines Boarding-Dialogs prüft der Event-Coordinator zuerst die aktuelle gespeicherte
Dispatch-Revision. Der erste vollständige, noch nicht reservierte Batch, der fachlich und
kapazitätsseitig in das konkret geöffnete Flugzeug passt, wird unverändert übernommen. Die
prognostische Flugzeugannahme bindet den Batch dabei nicht. Nur wenn kein gespeicherter Batch passt,
berechnet der Event-Coordinator mit dem reinen Dispatch-Planer für das geöffnete Flugzeug genau eine
Welle. Er reserviert den so bestimmten Vorschlag für genau ein Flugzeug, Bedienkonto und Gerät.
Flight Line und Flight Director verwenden denselben in D1 gespeicherten Lease-Pool. Der
Event-Coordinator serialisiert Erwerb, Freigabe und `CALL_NEXT` gemeinsam mit den übrigen Kommandos
des Veranstaltungstags.

Eine Lease läuft nach 90 Sekunden ohne Verlängerung ab. Die beim Erwerb aktuelle
`operation_day_version` bleibt Herkunftsinformation und ist kein pauschaler Invalidierungsgrund.
Unabhängige Ereignisse ersetzen deshalb weder Lease-ID noch Gruppenmenge oder Ablaufzeit. Eine Lease
wird nur ungültig, wenn Ablauf, Flugzeugverfügbarkeit, Gruppenverfügbarkeit, Segmentreihenfolge,
Kapazität oder Eigentümer nicht mehr passen.

Der Dialog zeigt die verbleibende Zeit an. Erwerb, explizites Neuladen, manuelle Auswahl, Schließen und
Freigabe laufen clientseitig über genau eine serialisierte Transition-Queue. Gleichzeitige Erwerbs-
oder Reload-Absichten für dasselbe Flugzeug werden zusammengeführt. Das Schließen während eines
laufenden Erwerbs gibt dessen späteres Ergebnis genau einmal frei; unmittelbares Wiederöffnen wartet
diese Freigabe ab. Eine ältere Antwort darf dadurch niemals eine bereits von einer neueren Transition
übernommene Lease freigeben. Ablauf bleibt die Absicherung für Verbindungs- oder Browserverlust.

Eine manuelle Änderung der vorgeschlagenen Auswahl gibt die eigene Lease ebenfalls frei. Eine manuelle
Belegung bleibt trotz fremder Leases möglich und unterliegt weiter Abweichungsgrund-, Kapazitäts-,
Produkt- und Versionsprüfung. Überlappende fremde Leases werden mit Grund `MANUAL_OVERRIDE` atomar mit
dem erfolgreichen `CALL_NEXT` invalidiert und vollständig auditiert.

Die flugzeugbezogene Ein-Wellen-Planung verwendet unverändert den reinen Dispatch-Planer. Harte
Kompatibilitäts- und Gruppenschutzregeln stehen zuerst, danach maximale Wartezeit, Überholschutz und
Produktfairness. Unter danach gleichwertigen Kombinationen wird die höchste Sitzplatzauslastung
gewählt; Queueposition, Verkaufszeit und technische ID lösen verbleibende Gleichstände deterministisch
auf. Bei bewusst geteilten Buchungsgruppen stammt die harte Segmentreihenfolge aus der beim Verkauf
persistierten technischen Rotationsfolge; die Kommunikationsnummer ist auch dort kein Sortier- oder
Bewertungsschlüssel. `GO TO GATE` ist eine organisatorische Verpflichtung, aber keine Flugzeugbindung.
Insbesondere ist `forecast_assumed_aircraft_id` nur eine Prognoseannahme und schränkt weder
Lease-Erwerb noch Relevanzprüfung einer aufgerufenen Gruppe auf dieses angenommene Flugzeug ein.

Für den Überholschutz verwendet die Lease-Planung ausschließlich durch erfolgreiche
`CALL_NEXT`-Kommandos bestätigte Überholungen. Die prognostische Überholungszahl der aktuellen
Dispatch-Revision bleibt Diagnose und darf eine neue Lease nicht selbstverstärkend umsortieren.
Lease-Erwerb und `CALL_NEXT` auditieren zusätzlich, ob ein gespeicherter Batch übernommen oder eine
flugzeugbezogene Ersatzplanung verwendet wurde und welche bestätigten Überholungen entstanden.

`CALL_NEXT` bestätigt eine Lease nur, wenn Eigentümer, Gerät, Flugzeug, Ablauf, Planrevision, Batch,
vollständige Gruppenmenge, konkrete offene Segmente und Sitzanzahl noch übereinstimmen. Die Lease wird
atomar mit dem erfolgreichen Boarding verbraucht. Ein `STALE_VERSION` lehnt nur den Schreibversuch ab;
nach Aktualisierung des Board-Stands bleiben Lease und Auswahl für eine erneute menschliche Bestätigung
erhalten. Eine fachlich relevante Invalidierung wird sichtbar gemeldet und niemals automatisch durch
eine andere Auswahl ersetzt. Einen neuen freien Vorschlag lädt ausschließlich die Aktion
„Aktuellsten Vorschlag laden“.

## Fachliche Abgrenzung

Die Lease reserviert nur die Möglichkeit, einen angezeigten Vorschlag kurzfristig zu bestätigen. Sie
ist keine Ticketzuordnung, keine dauerhafte Flugzeugzuordnung, keine Slot-Garantie und keine
flugbetriebliche oder sicherheitsbezogene Freigabe. Die konkrete Zuordnung entsteht weiterhin erst
durch das erfolgreiche, auditierte `CALL_NEXT`.

## Persistenz, Audit und Wiederherstellung

Migration `0064_dispatch_recommendation_leases.sql` legt die additive Koordinationstabelle mit
eindeutigen aktiven Leases pro Batch, Flugzeug und Bediengerät an. Erwerb, Freigabe, Ablauf, relevante
Invalidierung, manuelle Übersteuerung und Verbrauch erzeugen append-only Audit-Ereignisse.
Ereignislöschung, Kontolöschung und Werksreset
entfernen die kurzlebigen Leases. Vor der Migration ist eine D1-Time-Travel-Marke oder portable
Sicherung anzulegen; eine vollständige Rückkehr zum vorherigen Schema erfolgt durch deren
Wiederherstellung.

## Folgen und Nachweise

- Konkurrenztests decken ersten Erwerber, Flugzeug-, Batch- und Geräteexklusivität ab.
- Kommandotests decken Ablauf, Eigentümer-/Geräteprüfung, relevante Planänderung, manuelle
  Übersteuerung und atomaren Verbrauch ab.
- UI-Tests decken Countdown, stabile Lease über unabhängige Versionswechsel, die serialisierte
  Transition-Queue, sichtbare Invalidierung und explizites Neuladen ab.
- Browserabnahmen prüfen Flight Line und Flight Director in hellen und dunklen Viewports.
