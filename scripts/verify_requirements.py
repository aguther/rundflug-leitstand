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
BACKLOG_PATH = ROOT / "docs/backlog/v1-initial.md"
ID_PATTERN = re.compile(r"^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$")
ALLOWED_PRIORITIES = {"MUSS", "SOLL", "KANN"}
ALLOWED_STAGES = {"V1", "V2", "V3", "V4"}
ALLOWED_STATUSES = {"geplant", "in Arbeit", "umgesetzt", "abgenommen", "entfällt"}
BACKLOG_PATTERN = re.compile(r"^BP-(?:0[1-9]|1[0-2])$")


def verify_release_version() -> str:
    root_package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    version = root_package["version"]
    package_paths = sorted(
        [*(ROOT / "apps").glob("*/package.json"), *(ROOT / "packages").glob("*/package.json")]
    )
    mismatches = [
        str(path.relative_to(ROOT))
        for path in package_paths
        if json.loads(path.read_text(encoding="utf-8"))["version"] != version
    ]
    if mismatches:
        fail(f"workspace package versions differ from {version}: {mismatches}")

    versioned_paths = [
        ROOT / f"docs/requirements/requirements-v{version}.md",
        ROOT / f"docs/requirements/requirements-v{version}.yaml",
        ROOT / f"docs/requirements/traceability-v{version}.csv",
        ROOT / f"docs/ui/v{version}-cashier-concept.md",
    ]
    missing = [str(path.relative_to(ROOT)) for path in versioned_paths if not path.exists()]
    if missing:
        fail(f"release {version} is missing version-aligned artifacts: {missing}")

    release_yaml = versioned_paths[1].read_text(encoding="utf-8")
    if not release_yaml.startswith(f"version: {version}\n"):
        fail(f"requirements-v{version}.yaml does not declare version {version}")
    release_ids = re.findall(r"^  - id: ([A-Z0-9-]+)$", release_yaml, re.MULTILINE)
    with versioned_paths[2].open(newline="", encoding="utf-8-sig") as handle:
        trace_ids = [row["ID"] for row in csv.DictReader(handle)]
    if release_ids != trace_ids:
        fail(f"release {version} requirements and traceability IDs differ")

    config_source = (ROOT / "packages/config/src/index.ts").read_text(encoding="utf-8")
    worker_source = (ROOT / "apps/worker/src/index.ts").read_text(encoding="utf-8")
    backup_source = (ROOT / "apps/worker/src/backup.ts").read_text(encoding="utf-8")
    if 'APP_VERSION = rootPackage.version' not in config_source:
        fail("runtime application version is not derived from the root package")
    if "REQUIREMENTS_VERSION = APP_VERSION" not in config_source:
        fail("runtime requirements version is not aligned with the application version")
    if "applicationVersion: APP_VERSION" not in worker_source:
        fail("health endpoint does not expose the application version")
    if "requirementsVersion: REQUIREMENTS_VERSION" not in backup_source:
        fail("portable backups do not use the aligned requirements version")
    return version


def load_json_compatible_yaml(path: Path):
    # The generated YAML is intentionally valid JSON as well, avoiding a runtime PyYAML dependency.
    return json.loads(path.read_text(encoding="utf-8"))


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    release_version = verify_release_version()
    requirements = load_json_compatible_yaml(YAML_PATH)
    if len(requirements) != 207:
        fail(f"expected 207 requirements, found {len(requirements)}")

    ids = [item["id"] for item in requirements]
    if len(ids) != len(set(ids)):
        fail("duplicate requirement IDs in requirements-v1.4.yaml")
    invalid = [value for value in ids if not ID_PATTERN.match(value)]
    if invalid:
        fail(f"invalid requirement IDs: {invalid}")
    required_fields = {"id", "requirement", "priority", "stage", "section", "implementation", "tests"}
    incomplete = [item.get("id", "<without id>") for item in requirements if not required_fields <= item.keys()]
    if incomplete:
        fail(f"requirements with missing fields: {incomplete}")
    invalid_priorities = sorted({item["priority"] for item in requirements} - ALLOWED_PRIORITIES)
    invalid_stages = sorted({item["stage"] for item in requirements} - ALLOWED_STAGES)
    if invalid_priorities:
        fail(f"invalid priorities: {invalid_priorities}")
    if invalid_stages:
        fail(f"invalid stages: {invalid_stages}")

    with CSV_PATH.open(newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle))
    csv_ids = [row["ID"] for row in rows]
    if set(csv_ids) != set(ids):
        missing = sorted(set(ids) - set(csv_ids))
        extra = sorted(set(csv_ids) - set(ids))
        fail(f"traceability mismatch; missing={missing}, extra={extra}")
    if len(csv_ids) != len(set(csv_ids)):
        fail("duplicate requirement IDs in traceability.csv")

    requirements_by_id = {item["id"]: item for item in requirements}
    metadata_mismatches = []
    for row in rows:
        requirement = requirements_by_id[row["ID"]]
        if row["Stufe"] != requirement["stage"] or row["Priorität"] != requirement["priority"]:
            metadata_mismatches.append(row["ID"])
    if metadata_mismatches:
        fail(f"stage/priority mismatch in traceability rows: {metadata_mismatches}")

    invalid_statuses = sorted({row["Status"] for row in rows} - ALLOWED_STATUSES)
    if invalid_statuses:
        fail(f"invalid traceability statuses: {invalid_statuses}")

    v1_rows = [row for row in rows if row["Stufe"] == "V1"]
    incomplete_v1 = [
        row["ID"]
        for row in v1_rows
        if not row["Modul"].strip() or not row["Tests"].strip()
    ]
    if incomplete_v1:
        fail(f"V1 traceability rows without module/test assignment: {incomplete_v1}")

    invalid_modules = sorted(
        {
            module.strip()
            for row in v1_rows
            for module in row["Modul"].split("+")
            if not BACKLOG_PATTERN.match(module.strip())
        }
    )
    if invalid_modules:
        fail(f"invalid V1 backlog package references: {invalid_modules}")

    backlog = BACKLOG_PATH.read_text(encoding="utf-8")
    missing_packages = [
        f"BP-{number:02d}" for number in range(1, 13) if f"## BP-{number:02d} " not in backlog
    ]
    if missing_packages:
        fail(f"backlog packages missing from v1-initial.md: {missing_packages}")

    v1_must = [row for row in v1_rows if row["Priorität"] == "MUSS"]
    if len(v1_must) != 166:
        fail(f"expected 166 V1 MUSS requirements, found {len(v1_must)}")

    print(
        f"OK: release {release_version}, {len(ids)} unique requirements, "
        f"{len(v1_rows)} assigned V1 rows and {len(v1_must)} assigned V1 MUSS rows"
    )


if __name__ == "__main__":
    main()
