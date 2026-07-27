-- Deklarative iOS-Push-Nachrichten benötigen eine absolute Navigations-URL. Safari parst
-- `navigate` ohne Basis-URL und verwirft die gesamte Nachricht, sobald daraus keine gültige URL
-- entsteht; ein relativer Pfad ist damit unzustellbar. Der Ursprung der Statusseite wird deshalb
-- bei der Einwilligung mitgeschrieben.
--
-- Der Ursprung ist die öffentliche Adresse der Statusseite und keine personenbezogene Angabe. Er
-- wird wie das übrige Push-Ziel behandelt: aus portablen R2-Sicherungen ausgeschlossen und
-- gemeinsam mit dem Abonnement gelöscht. Bestandsabonnements bleiben ohne Ursprung gültig und
-- erhalten ihn bei der nächsten Einwilligung; ein Rollback erfolgt per D1 Time Travel, weil D1
-- additive Spalten nicht ohne Tabellenneuaufbau entfernen kann.

ALTER TABLE web_push_subscriptions ADD COLUMN origin TEXT;
