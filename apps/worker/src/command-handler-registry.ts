import type { CommandEnvelope } from "@rundflug/contracts";

export type CommandType<Envelope extends CommandEnvelope = CommandEnvelope> = Envelope["type"];

export type CommandFamily =
  | "attendance"
  | "event-administration"
  | "fleet-administration"
  | "master-data"
  | "operational-control"
  | "operational-note"
  | "outage-recovery"
  | "pilot-assignment"
  | "planned-operations"
  | "product-sales"
  | "recurring-operational-rules"
  | "rotation-correction"
  | "rotation-recovery"
  | "rotation-transition"
  | "ticket-group-mutation";

export type CommandByType<
  Type extends CommandEnvelope["type"],
  Envelope extends CommandEnvelope = CommandEnvelope,
> = Extract<Envelope, { type: Type }>;

export interface CommandHandlerEntry<
  Type extends CommandEnvelope["type"],
  Envelope extends CommandEnvelope = CommandEnvelope,
> {
  family: CommandFamily;
  handle: (command: CommandByType<Type, Envelope>) => Promise<Response>;
}

export type CommandHandlerRegistry<Envelope extends CommandEnvelope = CommandEnvelope> = {
  readonly [Type in CommandType<Envelope>]: CommandHandlerEntry<Type, Envelope>;
};

export function defineCommandHandlerRegistry<Envelope extends CommandEnvelope = CommandEnvelope>(
  registry: CommandHandlerRegistry<Envelope>,
): CommandHandlerRegistry<Envelope> {
  return registry;
}

export function dispatchRegisteredCommand<Envelope extends CommandEnvelope>(
  registry: CommandHandlerRegistry<Envelope>,
  command: Envelope,
): Promise<Response> {
  // The registry type proves the key-to-command correlation at construction. TypeScript loses
  // that correlation for a runtime union lookup, so erasure is restricted to this single boundary.
  const entry = Reflect.get(registry, command.type) as unknown as {
    handle: (registeredCommand: Envelope) => Promise<Response>;
  };
  return entry.handle(command);
}
