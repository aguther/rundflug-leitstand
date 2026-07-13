#!/usr/bin/env python3
"""Runs a portable-backup round trip against two isolated SQLite databases."""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "apps" / "worker" / "migrations"
BACKUP_SOURCE = ROOT / "apps" / "worker" / "src" / "backup.ts"


def backup_tables() -> list[str]:
    source = BACKUP_SOURCE.read_text(encoding="utf-8")
    match = re.search(r"BACKUP_TABLES = \[(.*?)\] as const", source, re.DOTALL)
    if not match:
        raise AssertionError("BACKUP_TABLES konnte nicht gelesen werden")
    return re.findall(r'"([a-z_]+)"', match.group(1))


def apply_schema(connection: sqlite3.Connection) -> None:
    for migration in sorted(MIGRATIONS.glob("[0-9][0-9][0-9][0-9]_*.sql")):
        connection.executescript(migration.read_text(encoding="utf-8"))


def seed_source(connection: sqlite3.Connection) -> None:
    now = "2026-07-11T08:00:00.000Z"
    connection.execute(
        "INSERT INTO operation_days "
        "(id,name,event_date,time_zone,status,created_at,updated_at,aerodrome) "
        "VALUES (?,?,?,?,?,?,?,?)",
        ("synthetic-event", "Synthetischer Flugtag", "2026-07-12", "Europe/Berlin", "PREPARATION", now, now, "EDXX"),
    )
    connection.execute(
        "INSERT INTO gates (id,operation_day_id,label,created_at,updated_at) VALUES (?,?,?,?,?)",
        ("synthetic-gate", "synthetic-event", "Flight Line 1", now, now),
    )
    connection.execute(
        "INSERT INTO resource_groups "
        "(id,operation_day_id,name,status,version,created_at,updated_at,gate_id) "
        "VALUES (?,?,?,?,?,?,?,?)",
        ("synthetic-group", "synthetic-event", "Standard", "ACTIVE", 0, now, now, "synthetic-gate"),
    )
    connection.execute(
        "INSERT INTO aircraft (id,registration,aircraft_type,passenger_seats,created_at,updated_at) "
        "VALUES (?,?,?,?,?,?)",
        ("synthetic-aircraft", "D-TEST", "TEST", 3, now, now),
    )
    connection.execute(
        "INSERT INTO pilots (id,operation_day_id,operational_code,created_at,updated_at) VALUES (?,?,?,?,?)",
        ("synthetic-pilot", "synthetic-event", "P-01", now, now),
    )
    connection.execute(
        "INSERT INTO resource_group_memberships "
        "(id,operation_day_id,resource_group_id,aircraft_id,active_from,created_at,current_pilot_id) "
        "VALUES (?,?,?,?,?,?,?)",
        ("synthetic-membership", "synthetic-event", "synthetic-group", "synthetic-aircraft", now, now, "synthetic-pilot"),
    )
    connection.execute(
        "INSERT INTO products "
        "(id,operation_day_id,resource_group_id,name,price_cents,sale_enabled,created_at,updated_at,code,gate_id) "
        "VALUES (?,?,?,?,?,?,?,?,?,?)",
        ("synthetic-product", "synthetic-event", "synthetic-group", "Panorama", 5000, 1, now, now, "PAN", "synthetic-gate"),
    )
    connection.execute(
        "INSERT INTO ticket_groups "
        "(id,operation_day_id,product_id,queue_sequence,status,sold_at) VALUES (?,?,?,?,?,?)",
        ("synthetic-ticket-group", "synthetic-event", "synthetic-product", 1, "QUEUED", now),
    )
    connection.execute(
        "INSERT INTO tickets "
        "(id,ticket_group_id,public_code_hash,status,weight_class,payment_status,price_cents,created_at) "
        "VALUES (?,?,?,?,?,?,?,?)",
        ("synthetic-ticket", "synthetic-ticket-group", "0" * 64, "QUEUED", "NOT_CAPTURED", "PAID", 5000, now),
    )
    connection.execute(
        "INSERT INTO flight_groups "
        "(id,operation_day_id,resource_group_id,communication_number,status,created_at,updated_at) "
        "VALUES (?,?,?,?,?,?,?)",
        ("synthetic-flight-group", "synthetic-event", "synthetic-group", 101, "DRAFT", now, now),
    )
    connection.execute(
        "INSERT INTO rotations "
        "(id,operation_day_id,flight_group_id,aircraft_id,status,version,created_at,updated_at,pilot_id,gate_id,operational_note) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        ("synthetic-rotation", "synthetic-event", "synthetic-flight-group", "synthetic-aircraft", "DRAFT", 0, now, now, "synthetic-pilot", "synthetic-gate", "Organisatorischer Testhinweis"),
    )
    connection.execute(
        "INSERT INTO rotation_tickets (rotation_id,ticket_id,assigned_at) VALUES (?,?,?)",
        ("synthetic-rotation", "synthetic-ticket", now),
    )
    connection.execute(
        "INSERT INTO paired_devices "
        "(id,operation_day_id,label,role,paired_at,last_seen_at,credential_hash) VALUES (?,?,?,?,?,?,?)",
        ("synthetic-admin", "synthetic-event", "Testgerät", "ADMIN", now, now, "1" * 64),
    )
    connection.execute(
        "INSERT INTO app_bootstrap (singleton,operation_day_id,admin_device_id,completed_at) VALUES (1,?,?,?)",
        ("synthetic-event", "synthetic-admin", now),
    )
    connection.execute(
        "INSERT INTO operational_events "
        "(id,operation_day_id,event_type,occurred_at,device_id,aggregate_type,aggregate_id,aggregate_version,payload_json) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        ("synthetic-event-record", "synthetic-event", "SYSTEM_BOOTSTRAPPED", now, "synthetic-admin", "OPERATION_DAY", "synthetic-event", 0, "{}"),
    )
    connection.commit()


def export_backup(connection: sqlite3.Connection, tables: list[str]) -> tuple[str, str]:
    connection.row_factory = sqlite3.Row
    payload = {
        "format": "rundflug-leitstand-portable-backup",
        "formatVersion": 1,
        "createdAt": "2026-07-11T02:15:00.000Z",
        "requirementsVersion": "1.4",
        "reason": "PRE_EVENT",
        "tables": {
            table: [dict(row) for row in connection.execute(f'SELECT * FROM "{table}"')]
            for table in tables
        },
    }
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return serialized, hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def restore_backup(connection: sqlite3.Connection, serialized: str, checksum: str, tables: list[str]) -> None:
    if hashlib.sha256(serialized.encode("utf-8")).hexdigest() != checksum:
        raise AssertionError("Prüfsumme des portablen Backups ist ungültig")
    payload = json.loads(serialized)
    if payload.get("format") != "rundflug-leitstand-portable-backup" or payload.get("formatVersion") != 1:
        raise AssertionError("Unbekanntes Backupformat")
    if set(payload.get("tables", {})) != set(tables):
        raise AssertionError("Backup enthält nicht exakt die freigegebenen Tabellen")
    for table in tables:
        for row in payload["tables"][table]:
            columns = list(row)
            placeholders = ",".join("?" for _ in columns)
            column_sql = ",".join(f'"{column}"' for column in columns)
            connection.execute(
                f'INSERT INTO "{table}" ({column_sql}) VALUES ({placeholders})',
                [row[column] for column in columns],
            )
    connection.commit()


def main() -> None:
    started = time.monotonic()
    tables = backup_tables()
    source = sqlite3.connect(":memory:")
    target = sqlite3.connect(":memory:")
    apply_schema(source)
    apply_schema(target)
    seed_source(source)
    serialized, checksum = export_backup(source, tables)
    restore_backup(target, serialized, checksum, tables)
    if target.execute("PRAGMA foreign_key_check").fetchall():
        raise AssertionError("Fremdschlüsselprüfung nach Restore fehlgeschlagen")
    for table in tables:
        source_count = source.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
        target_count = target.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
        if source_count != target_count:
            raise AssertionError(f"Mengenkontrolle für {table} fehlgeschlagen")
    if target.execute("SELECT COUNT(*) FROM operational_events").fetchone()[0] != 1:
        raise AssertionError("Append-only Auditbestand wurde nicht wiederhergestellt")
    restored_rotation = target.execute(
        "SELECT gate_id, operational_note FROM rotations WHERE id = ?",
        ("synthetic-rotation",),
    ).fetchone()
    if restored_rotation != ("synthetic-gate", "Organisatorischer Testhinweis"):
        raise AssertionError("Historisches Umlauf-Gate oder Bemerkung wurde nicht wiederhergestellt")
    source.close()
    target.close()
    elapsed = time.monotonic() - started
    if elapsed >= 30 * 60:
        raise AssertionError("Wiederanlauf überschreitet 30 Minuten")
    print(f"OK: isolierter Backup-Restore in {elapsed:.2f}s, Prüfsumme und Fremdschlüssel gültig")


if __name__ == "__main__":
    main()
