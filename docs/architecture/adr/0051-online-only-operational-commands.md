# ADR-0051: Onlinepflicht für operative Kommandos und lokale reversible Entwürfe

- Status: Akzeptiert
- Datum: 2026-08-16
- Ersetzt: ADR-0005 hinsichtlich einer automatisch übertragenen Offline-Kommando-Queue
- Betroffene Anforderungen: OQ-01, OQ-12, Q-ZUV-010, Q-ZUV-040

## Kontext

ADR-0005 sah zunächst eine allgemeine Offline-Kommando-Queue mit späterer Übertragung vor. Operative
Kommandos verändern jedoch Verkauf, Ressourcenbindung, Zustände und Auditierung. Eine verzögerte
Übertragung könnte trotz Expected-Version einen scheinbar erfolgreichen lokalen Stand erzeugen oder
eine Bedienperson zu einer fachlich überholten Wiederholung verleiten.

## Entscheidung

- Verkauf, Storno, Aufruf, Boarding, Flug-, Lande- und Abschlussereignisse, Not-Halt sowie
  Stammdatenänderungen benötigen eine unmittelbare Serverbestätigung.
- Offline bleiben ausschließlich lokal reversible Kassenentwürfe wie Produktauswahl und
  Gruppengröße. Sie besitzen keine operative Wirkung und sind sichtbar als ausstehend markiert.
- Entwürfe werden nach Wiederverbindung nicht automatisch gesendet. Die Kasse prüft sie erneut und
  bestätigt bewusst gegen die aktuelle Serverversion.
- Der letzte bestätigte operative Snapshot bleibt offline lesbar und zeigt Alter und Störungsstatus.
- Idempotenz, Expected-Version und sichtbare Konfliktauflösung aus ADR-0005 bleiben unverändert.

## Konsequenzen

Ein Verbindungsverlust kann operative Schreibarbeit unterbrechen, erzeugt aber keinen unbestätigten
Parallelzustand. Die PWA darf lokal hilfreiche Vorbereitung erhalten, ohne eine zweite fachliche
Source of Truth einzuführen.
