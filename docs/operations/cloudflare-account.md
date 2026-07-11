# Cloudflare-Kontoinhaberschaft

Für den operativen Betrieb wird ein eigenes Cloudflare-Konto beziehungsweise ein klar isolierter
Cloudflare-Account des Vereins empfohlen.

## Zielbild

- Eigentümer und Rechnungsempfänger ist der Verein beziehungsweise Projektträger.
- Keine gemeinsam genutzten Passwörter.
- Mindestens zwei individuell eingeladene Personen mit dokumentierter Vertretungsregel.
- Zwei-Faktor-Authentifizierung wird für alle Mitglieder erzwungen.
- Alltagstätigkeiten erhalten nur die Rolle `Workers Platform Admin`; Billing und Super-Administrator
  bleiben auf wenige Personen begrenzt.
- CI verwendet einen eng begrenzten Account-API-Token, keinen Global API Key.
- Abnahme und Produktion besitzen getrennte D1-, R2- und Worker-Ressourcen.
- Recovery-Codes und Kontowiederherstellung liegen in einem vereinsseitig kontrollierten Passwortsafe.

## Empfohlene Rollen

| Zweck | Rolle |
|---|---|
| technische Eigentümerschaft und Notfall | Super Administrator – All Privileges |
| tägliche Entwicklung/Deployment | Workers Platform Admin |
| Rechnungen und Tarif | Billing |
| Prüfung ohne Änderungen | Workers Platform (Read-only) / Audit Logs Viewer |

## Organisatorische Daten

- neutrale Rechnungsadresse und Kostenstelle
- Funktionspostfach für Billing-/Statusmeldungen
- dokumentierter Domain- und Account-Transferprozess
- jährliche Prüfung der Mitglieder und API-Tokens
