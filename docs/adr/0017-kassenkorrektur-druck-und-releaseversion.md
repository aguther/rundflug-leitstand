# ADR-0017: Kassenkorrektur, Ticketdruck und konsistente Releaseversion

- Status: Akzeptiert; ersetzt F-KAS-080 für neue Kommandos
- Datum: 2026-07-20
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: V16-REL-010, V16-KAS-010 bis V16-KAS-050, V16-TKT-010, V16-TKT-020

## Kontext

Die Kasse wird von eingewiesenem Fachpersonal bedient. Wiederkehrende Bestätigungen einer fachlich
sichtbaren Aufteilung erhöhen die Bedienlast. Gleichzeitig führten eine nicht live aktualisierte
Liste, uneinheitliche Statuswerte und konkurrierende Druckregeln zu missverständlichen Ergebnissen.
Die bisher getrennten Versionsstände von Anwendung und Anforderungen erschwerten die eindeutige
Kommunikation über einen Repository-Stand.

## Entscheidung

Der Verkauf wird im jeweiligen Produkt ausgelöst. Eine dauerhaft reservierte Informationsfläche
zeigt entweder den neutralen Kapazitätszustand oder die Aufteilung mit ihren Auswirkungen. Sie löst
keinen zusätzlichen Bestätigungsschritt aus und verschiebt weder Produktbereich noch Verkaufsaktion.

Umbuchung wird für neue Vorgänge entfernt. Eine Korrektur erfolgt durch auditierte Stornierung und
bewussten Neuverkauf. Historische append-only Ereignisse bleiben erhalten.

Vorschau und 58-mm-Druck verwenden dasselbe Dokument. Ein bestätigter Verkauf ist unabhängig vom
lokalen Browserdruck gültig; fehlende Druckdaten öffnen keinen leeren Druckdialog.

Die Root-Paketversion ist die Release-Source-of-Truth. Dieser Stand trägt überall `1.6.0`.
Feature-Releases erhöhen mindestens die Minor-, reine kompatible Fehlerkorrekturen die Patchversion.

## Folgen

Alte Clients können `REBOOK_TICKET_GROUP` nicht mehr erfolgreich senden und müssen aktualisiert
werden. Bestehende Umbuchungsdaten werden nicht migriert oder gelöscht. Die Versionsverifikation ist
Teil des verpflichtenden Checks. Der Browserdruck bleibt bewusst geräteunabhängig; es entsteht kein
fachlicher Druckstatus.
