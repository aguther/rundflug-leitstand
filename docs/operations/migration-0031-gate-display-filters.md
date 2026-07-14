# Migration 0031 – Gate-Anzeigefilter

Betroffene Anforderung: D-070.

Die Migration ergänzt `gates.display_filter_json` mit einem gültigen Show-all-Standard. Bestehende
Gates und Anzeigen verhalten sich deshalb nach der Migration unverändert. Ressourcengruppen werden
weiter ausschließlich über `resource_groups.gate_id` zugeordnet und nur in der API als abgeleitete
Liste ausgegeben.

Vor dem Einspielen ist ein portables R2-Backup zu erstellen. Bei einem Fehler wird der gesicherte
D1-Stand in eine neue Datenbank wiederhergestellt und die Worker-Bindung zurückgesetzt; ein
manuelles Entfernen der Spalte in der laufenden Datenbank ist nicht vorgesehen.
