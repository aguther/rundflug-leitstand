# Verifikation Nacherfassungsgrundlage

Stand: 12.07.2026

Die Domänensimulation deckt folgende OQ-08-Regeln automatisiert ab:

- Sortierung nach ursprünglicher Ereigniszeit und Papier-Belegfolge,
- vollständige Folge Verkauf → Aufruf → `IM FLUG` → `GELANDET` → `ABGESCHLOSSEN`,
- Ablehnung logisch unmöglicher Übergänge,
- Erkennung bereits vorhandener und unbekannter Papierbezüge,
- Erkennung doppelter Belegfolgen und zukünftiger Originalzeiten.

Die Transportverträge erlauben keine unbekannten Felder und weisen Gastidentitäten zurück. Die lokale
D1-Neuanlage mit allen 19 Migrationen wurde erfolgreich geprüft. Das additive Schema speichert auch
konfliktbehaftete Quellzeilen für die Vorsimulation, ohne sie auf den Livezustand anzuwenden.

Dieser Nachweis schließt OQ-08 noch nicht vollständig: Die tatsächliche Anwendung bleibt bis zur
Implementierung von Rollenprüfung, stale-Version-Prüfung und Vier-Augen-Freigabe gesperrt.
