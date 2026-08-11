import type { DeviceRole } from "@rundflug/domain";
import type { AttendanceCommandService } from "./attendance-command-service";
import { defineCommandHandlerRegistry } from "./command-handler-registry";
import type { EventAdministrationCommandService } from "./event-administration-command-service";
import type { FleetAdministrationCommandService } from "./fleet-administration-command-service";
import type { MasterDataCommandService } from "./master-data-command-service";
import type { OperationalControlCommandService } from "./operational-control-command-service";
import type { OperationalNoteCommandService } from "./operational-note-command-service";
import type { OutageRecoveryCommandService } from "./outage-recovery-command-service";
import type { PilotAssignmentCommandService } from "./pilot-assignment-command-service";
import type { PlannedOperationCommandService } from "./planned-operation-command-service";
import type { ProductSalesCommandService } from "./product-sales-command-service";
import type { RecurringOperationalRuleCommandService } from "./recurring-operational-rule-command-service";
import type { RotationCorrectionCommandService } from "./rotation-correction-command-service";
import type { RotationNoteCommandService } from "./rotation-note-command-service";
import type { RotationRecoveryCommandService } from "./rotation-recovery-command-service";
import type { RotationTransitionCommandService } from "./rotation-transition-command-service";
import type { TicketGroupMutationCommandService } from "./ticket-group-mutation-command-service";
import type { TicketSalesCommandService } from "./ticket-sales-command-service";
import type { StoredEventRow } from "./types";

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_CONTENT_TYPE);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export interface EventCommandServices {
  attendanceCommands: AttendanceCommandService;
  eventAdministrationCommands: EventAdministrationCommandService;
  fleetAdministrationCommands: FleetAdministrationCommandService;
  masterDataCommands: MasterDataCommandService;
  operationalControlCommands: OperationalControlCommandService;
  operationalNoteCommands: OperationalNoteCommandService;
  outageRecoveryCommands: OutageRecoveryCommandService;
  pilotAssignmentCommands: PilotAssignmentCommandService;
  plannedOperationCommands: PlannedOperationCommandService;
  productSalesCommands: ProductSalesCommandService;
  recurringOperationalRuleCommands: RecurringOperationalRuleCommandService;
  rotationCorrectionCommands: RotationCorrectionCommandService;
  rotationNoteCommands: RotationNoteCommandService;
  rotationRecoveryCommands: RotationRecoveryCommandService;
  rotationTransitionCommands: RotationTransitionCommandService;
  ticketGroupMutationCommands: TicketGroupMutationCommandService;
  ticketSalesCommands: TicketSalesCommandService;
}

export function createEventCommandHandlers(
  services: EventCommandServices,
  current: StoredEventRow,
  operatorAccountId: string | null,
  deviceRole: DeviceRole,
) {
  return defineCommandHandlerRegistry({
    SELL_TICKET_GROUP: {
      family: "product-sales",
      handle: (command) =>
        services.ticketSalesCommands.handleTicketSale(command, current, operatorAccountId),
    },
    STAGE_OUTAGE_RECOVERY: {
      family: "outage-recovery",
      handle: (command) =>
        services.outageRecoveryCommands.handleStageOutageRecovery(command, current),
    },
    APPROVE_OUTAGE_RECOVERY: {
      family: "outage-recovery",
      handle: (command) =>
        services.outageRecoveryCommands.handleApproveOutageRecovery(command, current),
    },
    APPLY_OUTAGE_RECOVERY: {
      family: "outage-recovery",
      handle: (command) =>
        services.outageRecoveryCommands.handleApplyOutageRecovery(command, current),
    },
    ASSIGN_AIRCRAFT_PILOT: {
      family: "pilot-assignment",
      handle: (command) =>
        services.pilotAssignmentCommands.handleAircraftPilotAssignment(command, current),
    },
    UPSERT_PLANNED_OPERATION: {
      family: "planned-operations",
      handle: (command) =>
        services.plannedOperationCommands.handlePlannedOperation(command, current, deviceRole),
    },
    CANCEL_PLANNED_OPERATION: {
      family: "planned-operations",
      handle: (command) =>
        services.plannedOperationCommands.handlePlannedOperation(command, current, deviceRole),
    },
    SET_PLANNED_SLOWDOWN_ACTIVE: {
      family: "planned-operations",
      handle: (command) =>
        services.plannedOperationCommands.handlePlannedOperation(command, current, deviceRole),
    },
    UPSERT_RECURRING_OPERATIONAL_RULE: {
      family: "recurring-operational-rules",
      handle: (command) =>
        services.recurringOperationalRuleCommands.handleRecurringOperationalRule(command, current),
    },
    DISABLE_RECURRING_OPERATIONAL_RULE: {
      family: "recurring-operational-rules",
      handle: (command) =>
        services.recurringOperationalRuleCommands.handleRecurringOperationalRule(command, current),
    },
    SET_AIRCRAFT_OPERATIONAL_STATE: {
      family: "fleet-administration",
      handle: (command) =>
        services.fleetAdministrationCommands.handleFleetAdministration(command, current),
    },
    SCHEDULE_AIRCRAFT_REFUEL: {
      family: "fleet-administration",
      handle: (command) =>
        services.fleetAdministrationCommands.handleFleetAdministration(command, current),
    },
    CONFIGURE_AIRCRAFT_REFUEL_THRESHOLD: {
      family: "fleet-administration",
      handle: (command) =>
        services.fleetAdministrationCommands.handleFleetAdministration(command, current),
    },
    SET_PILOT_PAUSE: {
      family: "fleet-administration",
      handle: (command) =>
        services.fleetAdministrationCommands.handleFleetAdministration(command, current),
    },
    UPSERT_PILOT: {
      family: "fleet-administration",
      handle: (command) =>
        services.fleetAdministrationCommands.handleFleetAdministration(command, current),
    },
    PAIR_DEVICE: {
      family: "event-administration",
      handle: (command) => services.eventAdministrationCommands.handleDevices(command, current),
    },
    REVOKE_DEVICE: {
      family: "event-administration",
      handle: (command) => services.eventAdministrationCommands.handleDevices(command, current),
    },
    CONFIGURE_PRODUCT_SALES: {
      family: "product-sales",
      handle: (command) =>
        services.productSalesCommands.handleProductSalesConfiguration(command, current),
    },
    CONFIGURE_EVENT_PARAMETERS: {
      family: "event-administration",
      handle: (command) => services.eventAdministrationCommands.handleParameters(command, current),
    },
    REORDER_CASHIER_PRODUCTS: {
      family: "master-data",
      handle: (command) =>
        services.masterDataCommands.handleCashierProductReorder(command, current),
    },
    SET_EVENT_LIFECYCLE: {
      family: "event-administration",
      handle: (command) => services.eventAdministrationCommands.handleLifecycle(command, current),
    },
    DELETE_MASTER_DATA: {
      family: "master-data",
      handle: (command) => services.masterDataCommands.handleMasterDataDeletion(command, current),
    },
    UPSERT_GATE: {
      family: "master-data",
      handle: (command) => services.masterDataCommands.handleMasterData(command, current),
    },
    UPSERT_PRODUCT: {
      family: "master-data",
      handle: (command) => services.masterDataCommands.handleMasterData(command, current),
    },
    UPSERT_AIRCRAFT_PRODUCT_TURNAROUND_OVERRIDE: {
      family: "master-data",
      handle: (command) =>
        services.masterDataCommands.handleAircraftProductTurnaroundOverride(command, current),
    },
    DELETE_AIRCRAFT_PRODUCT_TURNAROUND_OVERRIDE: {
      family: "master-data",
      handle: (command) =>
        services.masterDataCommands.handleAircraftProductTurnaroundOverride(command, current),
    },
    UPSERT_RESOURCE_GROUP: {
      family: "master-data",
      handle: (command) =>
        services.masterDataCommands.handleResourceAndAircraftMasterData(command, current),
    },
    UPSERT_AIRCRAFT: {
      family: "master-data",
      handle: (command) =>
        services.masterDataCommands.handleResourceAndAircraftMasterData(command, current),
    },
    ASSIGN_AIRCRAFT_RESOURCE_GROUP: {
      family: "master-data",
      handle: (command) =>
        services.masterDataCommands.handleResourceAndAircraftMasterData(command, current),
    },
    TRIGGER_EMERGENCY: {
      family: "operational-control",
      handle: (command) => services.operationalControlCommands.handle(command, current),
    },
    CLEAR_EMERGENCY: {
      family: "operational-control",
      handle: (command) => services.operationalControlCommands.handle(command, current),
    },
    SET_EVENT_INTERRUPTION: {
      family: "operational-control",
      handle: (command) => services.operationalControlCommands.handle(command, current),
    },
    SET_RESOURCE_GROUP_STATUS: {
      family: "operational-control",
      handle: (command) => services.operationalControlCommands.handle(command, current),
    },
    SET_RESOURCE_GROUP_NOTICE: {
      family: "operational-control",
      handle: (command) => services.operationalControlCommands.handle(command, current),
    },
    REVOKE_CALL: {
      family: "rotation-recovery",
      handle: (command) => services.rotationRecoveryCommands.handleRevokeCall(command, current),
    },
    ABORT_ROTATION: {
      family: "rotation-recovery",
      handle: (command) => services.rotationRecoveryCommands.handleAbortRotation(command, current),
    },
    ABORT_ROTATION_TO_QUEUE_AND_MARK_AIRCRAFT_UNAVAILABLE: {
      family: "rotation-recovery",
      handle: (command) =>
        services.rotationRecoveryCommands.handleTechnicalRotationAbort(command, current),
    },
    SET_TICKET_ATTENDANCE: {
      family: "attendance",
      handle: (command) => services.attendanceCommands.handleTicketAttendance(command, current),
    },
    MARK_TICKET_NO_SHOW: {
      family: "attendance",
      handle: (command) => services.attendanceCommands.handleAttendanceException(command, current),
    },
    CONFIRM_ATTENDANCE_DECISION: {
      family: "attendance",
      handle: (command) => services.attendanceCommands.handleAttendanceException(command, current),
    },
    SET_ROTATION_NOTE: {
      family: "rotation-correction",
      handle: (command) => services.rotationNoteCommands.handle(command, current),
    },
    SET_ROTATION_CAPACITY: {
      family: "rotation-correction",
      handle: (command) =>
        services.rotationCorrectionCommands.handleRotationCapacity(command, current),
    },
    MOVE_TICKET_GROUP: {
      family: "rotation-correction",
      handle: (command) =>
        services.rotationCorrectionCommands.handleManualTicketGroupMove(command, current),
    },
    CORRECT_ROTATION_MANIFEST: {
      family: "rotation-correction",
      handle: (command) =>
        services.rotationCorrectionCommands.handleRotationManifestCorrection(command, current),
    },
    CANCEL_TICKET_GROUP: {
      family: "ticket-group-mutation",
      handle: (command) =>
        services.ticketGroupMutationCommands.handleTicketGroupMutation(command, current),
    },
    DEFER_TICKET_GROUP: {
      family: "ticket-group-mutation",
      handle: (command) =>
        services.ticketGroupMutationCommands.handleTicketGroupMutation(command, current),
    },
    MARK_NO_SHOW: {
      family: "ticket-group-mutation",
      handle: (command) =>
        services.ticketGroupMutationCommands.handleTicketGroupMutation(command, current),
    },
    CALL_NEXT: {
      family: "rotation-transition",
      handle: async (command) => {
        if (current.status !== "ACTIVE") {
          return json(
            {
              error: {
                code: "CALL_BLOCKED_EVENT_STATUS",
                message: "Neue Aufrufe sind nur bei aktiver Veranstaltung zulässig.",
              },
            },
            { status: 409 },
          );
        }
        if (current.emergency_mode === 1) {
          return json(
            {
              error: {
                code: "CALL_BLOCKED_EMERGENCY",
                message: "Neue Aufrufe sind im Notfallmodus gesperrt.",
              },
            },
            { status: 409 },
          );
        }
        if (current.operational_interrupted === 1) {
          return json(
            {
              error: {
                code: "CALL_BLOCKED_INTERRUPTION",
                message: "Neue Aufrufe sind während der Betriebsunterbrechung gesperrt.",
              },
            },
            { status: 409 },
          );
        }
        return services.rotationTransitionCommands.handle(command, current, operatorAccountId);
      },
    },
    MARK_OFF_BLOCK: {
      family: "rotation-transition",
      handle: (command) =>
        services.rotationTransitionCommands.handle(command, current, operatorAccountId),
    },
    MARK_ON_BLOCK: {
      family: "rotation-transition",
      handle: (command) =>
        services.rotationTransitionCommands.handle(command, current, operatorAccountId),
    },
    COMPLETE_TURNAROUND: {
      family: "rotation-transition",
      handle: (command) =>
        services.rotationTransitionCommands.handle(command, current, operatorAccountId),
    },
    CANCEL_ROTATION: {
      family: "rotation-transition",
      handle: (command) =>
        services.rotationTransitionCommands.handle(command, current, operatorAccountId),
    },
    SET_TICKET_GROUP_ATTENDANCE: {
      family: "attendance",
      handle: (command) =>
        services.attendanceCommands.handleTicketGroupAttendance(command, current),
    },
    START_TICKET_GROUP_RECALL: {
      family: "attendance",
      handle: (command) => services.attendanceCommands.handleTicketGroupRecall(command, current),
    },
    CLEAR_TICKET_GROUP_RECALL: {
      family: "attendance",
      handle: (command) => services.attendanceCommands.handleTicketGroupRecall(command, current),
    },
    MARK_TICKET_GROUP_MISSING: {
      family: "attendance",
      handle: (command) => services.attendanceCommands.handleTicketGroupPresence(command, current),
    },
    RESTORE_TICKET_GROUP_TO_QUEUE: {
      family: "attendance",
      handle: (command) => services.attendanceCommands.handleTicketGroupPresence(command, current),
    },
    RECALL_TICKET_GROUP: {
      family: "attendance",
      handle: (command) => services.attendanceCommands.handleTicketGroupPresence(command, current),
    },
    SET_OPERATIONAL_NOTE: {
      family: "operational-note",
      handle: (command) => services.operationalNoteCommands.handle(command, current),
    },
  });
}
