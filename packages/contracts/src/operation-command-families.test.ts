import { describe, expect, it } from "vitest";
import { administrationCommandSchemas } from "./operation-command-administration";
import { flightCommandSchemas } from "./operation-command-flight";
import { planningCommandSchemas } from "./operation-command-planning";
import { ticketingCommandSchemas } from "./operation-command-ticketing";
import { commandEnvelopeSchema } from "./operations-dispatch";

const commandFamilies = [
  administrationCommandSchemas,
  flightCommandSchemas,
  planningCommandSchemas,
  ticketingCommandSchemas,
] as const;

function discriminatorValues(schema: (typeof commandEnvelopeSchema.options)[number]): string[] {
  const discriminator = schema.shape.type;
  if ("options" in discriminator) return discriminator.options;
  return [...discriminator.values].map(String);
}

describe("operation command families", () => {
  it("composes the compatible command envelope from every family without gaps", () => {
    const familySchemas = commandFamilies.flat();

    expect(familySchemas).toHaveLength(57);
    expect(commandEnvelopeSchema.options).toEqual(familySchemas);
  });

  it("owns every command discriminator in exactly one family", () => {
    const commandTypes = commandFamilies.flatMap((family) => family.flatMap(discriminatorValues));

    expect(commandTypes).toHaveLength(59);
    expect(new Set(commandTypes)).toHaveLength(commandTypes.length);
  });
});
