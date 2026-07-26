-- Release 1.10.0: Konten können aus der Administration entfernt werden, ohne ihre historische
-- Identität oder sichtbare Kennung später erneut zu vergeben. Bestehende Konten bleiben aktiv.
-- Vor Anwendung ist eine D1-Time-Travel-Marke beziehungsweise vollständige D1-Sicherung anzulegen.
-- Ein älterer Worker ignoriert die nullable Spalte; eine Wiederherstellung erfolgt per Time Travel
-- oder aus der Sicherung.
ALTER TABLE operator_accounts ADD COLUMN deleted_at TEXT;

CREATE INDEX idx_operator_accounts_visible_role
  ON operator_accounts(deleted_at, role, login_code);
