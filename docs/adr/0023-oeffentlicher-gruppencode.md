# ADR-0023: Öffentlicher Gruppencode statt sichtbarer Personencodes

- Status: Akzeptiert
- Datum: 2026-07-23
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: V18-GRP-010, V18-API-010, V18-DAT-010 und V18-OPS-010

## Kontext

Individuelle Ticketcodes bilden interne Berechtigungsobjekte ab. Für Gäste ist jedoch die
Buchungsgruppe die stabile Kommunikationseinheit. Bei einer bewussten Aufteilung bleibt sie
verbunden und muss Statusänderungen aller Teilflüge gemeinsam abbilden. Mehrere sichtbare QR-Codes
pro Gruppe erhöhen Druckumfang und Verwechslungsgefahr ohne öffentlichen Mehrwert.

## Entscheidung

- Jede Buchungsgruppe besitzt einen zufälligen, nicht aufzählbaren öffentlichen Gruppencode. D1
  speichert dessen SHA-256-Hash zur Suche und den Klarwert ausschließlich im geschützten operativen
  Datensatz für autorisierte Nachdrucke.
- Neue Ausdrucke und Verkäufe liefern genau einen QR-Code auf `/gruppe/:code`. Personentickets
  behalten ihre internen Codes zur Rückwärtskompatibilität, zeigen oder drucken sie aber nicht.
- Die öffentliche Gruppenprojektion aggregiert alle aktuellen Umläufe der Gruppe. Sie veröffentlicht
  keine F-Kennung.
- Bestehende Gruppen übernehmen den ältesten Ticketcode. Daher funktionieren alte
  `/ticket/:code`-Links unverändert, während derselbe Bestand zusätzlich über die neue Gruppenroute
  erreichbar ist.
- Neue Push-Abonnements referenzieren die Buchungsgruppe und werden für Statusänderungen jedes
  aktuellen Teilflugs ausgewählt.
- Weder Gruppen- noch Ticketcode wird in Audit-Payload, Outbox oder Anwendungslogs aufgenommen.

Diese Entscheidung konkretisiert und ersetzt ADR-0022 dort, wo ADR-0022 noch einen QR-Ticketstatus
je Person und die kombinierte Darstellung G(F) in der Flight-Line-Liste voraussetzte.

## Folgen und Wiederherstellung

Migration 0042 füllt Bestände deterministisch und additiv. Vor der Migration wird eine
D1-Time-Travel-Marke oder vollständige Sicherung erzeugt. Ein Rollback erfolgt durch Bereitstellung
des vorherigen Workers und Rücksetzen per D1 Time Travel beziehungsweise Wiederherstellung der
Sicherung. Das ist erforderlich, weil D1 additive Spalten nicht ohne Tabellenneuaufbau entfernt.
Portable fachliche Backups enthalten Buchungsgruppen und damit den geschützten Code; ephemere
Push-Abonnements bleiben wie bisher ausgeschlossen.
