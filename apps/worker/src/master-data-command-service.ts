import type { CommandEnvelope, CommandResult } from "@rundflug/contracts";
import { MasterDataDeletionService } from "./master-data-deletion-service";
import { MasterDataGateProductService } from "./master-data-gate-product-service";
import { MasterDataResourceService } from "./master-data-resource-service";
import { MasterDataTurnaroundService } from "./master-data-turnaround-service";
import type { Env, StoredEventRow } from "./types";

export class MasterDataCommandService {
  private readonly gateProductService: MasterDataGateProductService;
  private readonly turnaroundService: MasterDataTurnaroundService;
  private readonly deletionService: MasterDataDeletionService;
  private readonly resourceService: MasterDataResourceService;

  constructor(env: Env, broadcast: (result: CommandResult) => void) {
    this.gateProductService = new MasterDataGateProductService(env, broadcast);
    this.turnaroundService = new MasterDataTurnaroundService(env, broadcast);
    this.deletionService = new MasterDataDeletionService(env, broadcast);
    this.resourceService = new MasterDataResourceService(env, broadcast);
  }

  handleMasterData(
    command: Extract<CommandEnvelope, { type: "UPSERT_GATE" | "UPSERT_PRODUCT" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    return this.gateProductService.handleMasterData(command, current);
  }

  handleAircraftProductTurnaroundOverride(
    command: Extract<
      CommandEnvelope,
      {
        type:
          | "UPSERT_AIRCRAFT_PRODUCT_TURNAROUND_OVERRIDE"
          | "DELETE_AIRCRAFT_PRODUCT_TURNAROUND_OVERRIDE";
      }
    >,
    current: StoredEventRow,
  ): Promise<Response> {
    return this.turnaroundService.handleAircraftProductTurnaroundOverride(command, current);
  }

  handleCashierProductReorder(
    command: Extract<CommandEnvelope, { type: "REORDER_CASHIER_PRODUCTS" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    return this.turnaroundService.handleCashierProductReorder(command, current);
  }

  handleMasterDataDeletion(
    command: Extract<CommandEnvelope, { type: "DELETE_MASTER_DATA" }>,
    current: StoredEventRow,
  ): Promise<Response> {
    return this.deletionService.handleMasterDataDeletion(command, current);
  }

  handleResourceAndAircraftMasterData(
    command: Extract<
      CommandEnvelope,
      {
        type: "UPSERT_RESOURCE_GROUP" | "UPSERT_AIRCRAFT" | "ASSIGN_AIRCRAFT_RESOURCE_GROUP";
      }
    >,
    current: StoredEventRow,
  ): Promise<Response> {
    return this.resourceService.handleResourceAndAircraftMasterData(command, current);
  }
}
