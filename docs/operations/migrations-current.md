# Aktuelles Migrationsregister – Release 1.11.0

Diese Datei wird aus `apps/worker/migrations/*.sql` erzeugt. Vollständige Dateinamen sind die
D1-Identität; angewandte Dateien werden nicht nachträglich umbenannt.

| Reihenfolge | Datei | Hinweis |
| ---: | --- | --- |
| 1 | `0001_initial.sql` | eindeutig |
| 2 | `0002_device_identity.sql` | eindeutig |
| 3 | `0003_vertical_slice.sql` | eindeutig |
| 4 | `0004_device_credentials.sql` | eindeutig |
| 5 | `0005_operational_controls.sql` | eindeutig |
| 6 | `0006_web_push.sql` | eindeutig |
| 7 | `0007_capacity_controls.sql` | eindeutig |
| 8 | `0008_fleet_controls.sql` | eindeutig |
| 9 | `0009_aircraft_interruption_flag.sql` | eindeutig |
| 10 | `0010_resource_group_notices.sql` | eindeutig |
| 11 | `0011_event_interruption.sql` | eindeutig |
| 12 | `0012_pilot_assignment_and_pause.sql` | eindeutig |
| 13 | `0013_ticket_attendance.sql` | eindeutig |
| 14 | `0014_event_parameters.sql` | eindeutig |
| 15 | `0015_product_and_gate_master_data.sql` | eindeutig |
| 16 | `0016_resource_and_aircraft_master_data.sql` | eindeutig |
| 17 | `0017_multi_event_templates.sql` | eindeutig |
| 18 | `0018_forecast_timelines.sql` | eindeutig |
| 19 | `0019_outage_recovery.sql` | eindeutig |
| 20 | `0020_outage_recovery_references.sql` | eindeutig |
| 21 | `0021_web_push_delivery_queue.sql` | eindeutig |
| 22 | `0022_pilot_operational_note.sql` | eindeutig |
| 23 | `0023_aircraft_current_pilot.sql` | eindeutig |
| 24 | `0024_first_run_bootstrap.sql` | eindeutig |
| 25 | `0025_ticket_deferrals.sql` | eindeutig |
| 26 | `0026_rotation_gate_and_note.sql` | eindeutig |
| 27 | `0027_rotation_capacity_queue.sql` | eindeutig |
| 28 | `0028_factory_reset.sql` | eindeutig |
| 29 | `0029_forecast_snapshot_basis.sql` | eindeutig |
| 30 | `0030_rotation_manifest_corrections.sql` | eindeutig |
| 31 | `0031_gate_display_filters.sql` | eindeutig |
| 32 | `0032_factory_reset_forecast_snapshots.sql` | eindeutig |
| 33 | `0033_flight_line_assist_claims.sql` | eindeutig |
| 34 | `0034_automatic_precall.sql` | eindeutig |
| 35 | `0035_operator_accounts_and_sessions.sql` | eindeutig |
| 36 | `0036_product_promised_flight_time.sql` | historische Doppelnummer 0036, ausdrücklich erlaubt |
| 37 | `0036_v1_5_stable_operations.sql` | historische Doppelnummer 0036, ausdrücklich erlaubt |
| 38 | `0037_cashier_ticket_search.sql` | eindeutig |
| 39 | `0038_aircraft_state_changed_at.sql` | eindeutig |
| 40 | `0039_operator_owned_flight_line_claims.sql` | eindeutig |
| 41 | `0040_resource_group_short_codes.sql` | eindeutig |
| 42 | `0041_fids_display_accounts_and_preferences.sql` | eindeutig |
| 43 | `0042_group_status_codes_and_push.sql` | eindeutig |
| 44 | `0043_web_push_target_kind.sql` | eindeutig |
| 45 | `0044_event_logo_theme_variants.sql` | eindeutig |
| 46 | `0045_reset_setup_grants.sql` | eindeutig |
| 47 | `0046_operational_plans.sql` | eindeutig |
| 48 | `0047_operator_account_soft_delete.sql` | eindeutig |
| 49 | `0048_event_deletion_receipts.sql` | eindeutig |
| 50 | `0049_operational_plan_slowdown.sql` | eindeutig |
| 51 | `0050_recurring_operational_rules.sql` | eindeutig |
| 52 | `0051_web_push_origin.sql` | eindeutig |
| 53 | `0052_precall_decisions.sql` | eindeutig |
| 54 | `0053_distinct_public_push_transitions.sql` | eindeutig |
| 55 | `0054_remove_resource_group_planned_rotation.sql` | eindeutig |
| 56 | `0055_ticket_group_recalls.sql` | eindeutig |
| 57 | `0056_product_pure_flight_groups.sql` | eindeutig |
| 58 | `0057_turnaround_phase_overrides.sql` | eindeutig |
| 59 | `0058_forecast_turnaround_sources.sql` | eindeutig |
| 60 | `0059_ticket_group_cashier_attribution.sql` | eindeutig |
| 61 | `0060_dispatch_planning_and_gate_travel_lead.sql` | eindeutig |

Gesamt: 61 Migrationen. Wiederherstellungsnotizen werden gegen SQL und
`apps/worker/migrations/README.md` geprüft.
