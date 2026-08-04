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

Beim Öffnen eines Boarding-Dialogs berechnet der Event-Coordinator mit dem reinen Dispatch-Planer für
das konkret geöffnete Flugzeug genau eine Welle. Er reserviert den ersten aktuell passenden, noch
nicht reservierten Vorschlag für genau ein Flugzeug, Bedienkonto und Gerät. Flight Line und Flight
Director verwenden denselben in D1 gespeicherten Lease-Pool. Der Event-Coordinator serialisiert Erwerb,
Freigabe und `CALL_NEXT` gemeinsam mit den übrigen Kommandos des Veranstaltungstags.

Eine Lease läuft nach 90 Sekunden ohne Verlängerung ab. Die beim Erwerb aktuelle
`operation_day_version` bleibt Herkunftsinformation und ist kein pauschaler Invalidierungsgrund.
Unabhängige Ereignisse ersetzen deshalb weder Lease-ID noch Gruppenmenge oder Ablaufzeit. Eine Lease
wird nur ungültig, wenn Ablauf, Flugzeugverfügbarkeit, Gruppenverfügbarkeit, Segmentreihenfolge,
Kapazität oder Eigentümer nicht mehr passen.

Der Dialog zeigt die verbleibende Zeit an und gibt die Lease beim Schließen frei; eine clientseitige
Release-Barriere serialisiert unmittelbares Wiederöffnen hinter der Freigabe. Ablauf bleibt die
Absicherung für Verbindungs- oder Browserverlust. Eine manuelle Änderung der vorgeschlagenen Auswahl
gibt die eigene Lease ebenfalls frei. Eine manuelle Belegung bleibt trotz fremder Leases möglich und
unterliegt weiter Abweichungsgrund-, Kapazitäts-, Produkt- und Versionsprüfung. Überlappende fremde
Leases werden mit Grund `MANUAL_OVERRIDE` atomar mit dem erfolgreichen `CALL_NEXT` invalidiert und
vollständig auditiert.

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
- UI-Tests decken Countdown, stabile Lease über unabhängige Versionswechsel, Release-Barriere,
  sichtbare Invalidierung und explizites Neuladen ab.
- Browserabnahmen prüfen Flight Line und Flight Director in hellen und dunklen Viewports.
