-- Release 1.8.0: Push-Ziele unterscheiden kanonische Gruppen- und einzelne Ticketansichten.
-- Vor Anwendung ist eine D1-Time-Travel-Marke beziehungsweise eine vollständige D1-Sicherung
-- anzulegen. Bestehende Abonnements werden auf den seit V1.8 kanonischen Gruppenstatus
-- zurückgeführt. Ein Rollback erfolgt per D1 Time Travel oder aus dieser Sicherung, weil D1
-- additive Spalten nicht ohne Tabellenneuaufbau entfernen kann.
--
-- Web-Push-Abonnements bleiben wie bisher aus portablen R2-Backups ausgeschlossen. Die
-- Wiederherstellung eines Push-Ziels erfolgt deshalb ausschließlich aus D1 Time Travel oder
-- durch eine erneute Einwilligung des Gastes.

ALTER TABLE web_push_subscriptions ADD COLUMN target_kind TEXT NOT NULL DEFAULT 'GROUP'
  CHECK (target_kind IN ('TICKET', 'GROUP'));

CREATE INDEX idx_web_push_target_active
  ON web_push_subscriptions(target_kind, status, delete_after);
