# Wartbarkeit, Konfiguration und Erweiterungsgrenzen V1

## Q-WAR-010: Standardtechnologien

Der Rundflug-Leitstand verwendet TypeScript durchgängig, React und Vite für die PWA, HTTP und
WebSocket als Transport, Zod für ausführbare Verträge sowie SQLite-kompatibles SQL für den
relationalen Zustand. Hono bleibt eine dünne HTTP-Schicht. Biome, TypeScript und Vitest bilden die
lokale Werkzeugkette. Alle Laufzeit- und Build-Abhängigkeiten sind im npm-Lockfile reproduzierbar
festgeschrieben; eine maschinengeprüfte Allowlist verhindert das unbemerkte Einführen exotischer
Bibliotheken.

Cloudflare-spezifische Typen, Bindings und Durable Objects liegen ausschließlich in `apps/worker`.
Das Paket `packages/domain` besitzt keine Laufzeitabhängigkeiten und importiert weder Cloudflare,
Datenbank, HTTP noch React. Die portablen Transportverträge liegen getrennt in
`packages/contracts`. Ein erfahrener TypeScript-Webentwickler kann Fachlogik, Verträge, Adapter und
Oberfläche dadurch unabhängig lesen und testen.

Ein Betreiberwechsel erfordert neue Adapter für Hosting, serialisierte Kommandoverarbeitung,
WebSocket-Verteilung und Objektspeicher, aber keine Neuentwicklung der Fachregeln. Portable JSON-
Sicherungen und CSV-Exporte verhindern, dass operative Daten ausschließlich in einem proprietären
Format verbleiben.

## Q-WAR-020: Konfiguration ohne Programmänderung

| Konfigurationsgruppe | Administrativer Schreibpfad |
| --- | --- |
| Verkaufsbeginn und Betriebsende | Veranstaltungsparameter |
| No-Show-Frist und maximale Zurückstellungen | Veranstaltungsparameter |
| Vorbereitungs-/Benachrichtigungsvorlauf | Veranstaltungsparameter |
| Referenzgewichte | Veranstaltungsparameter |
| Boarding-, Deboarding- und Pufferzeit | Veranstaltungsparameter |
| öffentliche Texte und organisatorische Hinweise | Produkt-, Veranstaltungs-, Ressourcen- und Umlaufpflege |
| Kapazitätswarnung und kritischer Schwellenwert | Verkaufssteuerung je Produkt |
| Produktkapazität und Referenzflugzeit | Produktpflege |
| aktivierte Gewichtsklassen und Begleitpflicht | Produktpflege |
| Ressourcenkapazität und Planumlaufzeit | Ressourcengruppenpflege |
| Gates, Sortierung und Status | Gatepflege |

Jede Änderung läuft über einen typisierten Befehl mit Geräteberechtigung, erwarteter Version,
Idempotenzbeleg, Audit-Ereignis und Outbox. Es ist kein Deployment und keine Codeänderung nötig.
Sicherheits- oder luftrechtliche Grenzwerte werden bewusst nicht modelliert; sämtliche Angaben sind
rein organisatorisch.

## Q-WAR-040: Erweiterungsgrenzen V2 bis V4

- Ressourcengruppen und Produkte sind getrennte Entitäten; mehrere Produkte können dieselbe
  Ressourcengruppe und Queue verwenden.
- Gates sind eigenständige Stammdaten und werden von Ressourcengruppen, Produkten und historischen
  Umläufen referenziert.
- Flugzeuge besitzen individuelle Sitzplatzkapazität; die operative Umlaufkapazität kann davon
  getrennt reduziert werden.
- Veranstaltungen sind getrennte Mandanten-/Tagesaggregate und können aus einer früheren
  Veranstaltung beziehungsweise Vorlage erzeugt werden.
- Fachliche Kommandos, Statusabfragen und Realtime-Nachrichten besitzen dokumentierte typisierte
  Verträge. Spätere Wetter-, ADS-B- oder andere Ereignisquellen werden als Adapter vor diesem
  Kommandoeingang ergänzt und dürfen keine Domäneninvariante umgehen.
- Ein späteres Passagierlistenmodul bleibt außerhalb des anonymen Ticketkerns und benötigt einen
  eigenen Berechtigungs- und Speicheradapter.

## Ausführbare Nachweise

`apps/worker/src/maintainability-coverage.test.ts` prüft Abhängigkeits-Allowlist, Domain-Grenze,
Konfigurationsabdeckung sowie die modellierten Erweiterungspunkte. Die vorhandenen Stammdaten- und
Vertical-Slice-Integrationen prüfen zusätzlich, dass Konfigurationen nicht nur im Vertrag stehen,
sondern persistiert und im operativen Zustand wirksam werden.
