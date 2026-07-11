#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
YAML_PATH = ROOT / "docs/requirements/requirements-v1.4.yaml"
CSV_PATH = ROOT / "docs/requirements/traceability.csv"
ID_PATTERN = re.compile(r"^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$")


def load_json_compatible_yaml(path: Path):
    # The generated YAML is intentionally valid JSON as well, avoiding a runtime PyYAML dependency.
    return json.loads(path.read_text(encoding="utf-8"))


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    requirements = load_json_compatible_yaml(YAML_PATH)
    if len(requirements) != 199:
        fail(f"expected 199 requirements, found {len(requirements)}")

    ids = [item["id"] for item in requirements]
    if len(ids) != len(set(ids)):
        fail("duplicate requirement IDs in requirements-v1.4.yaml")
    invalid = [value for value in ids if not ID_PATTERN.match(value)]
    if invalid:
        fail(f"invalid requirement IDs: {invalid}")

    with CSV_PATH.open(newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle))
    csv_ids = [row["ID"] for row in rows]
    if set(csv_ids) != set(ids):
        missing = sorted(set(ids) - set(csv_ids))
        extra = sorted(set(csv_ids) - set(ids))
        fail(f"traceability mismatch; missing={missing}, extra={extra}")
    if len(csv_ids) != len(set(csv_ids)):
        fail("duplicate requirement IDs in traceability.csv")

    print(f"OK: {len(ids)} unique requirements and matching traceability rows")


if __name__ == "__main__":
    main()
