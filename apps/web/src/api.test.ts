import { describe, expect, it } from "vitest";
import { assertOperationalConnection } from "./api";

describe("operational command connection policy", () => {
  it("rejects operative commands without a server connection", () => {
    expect(() => assertOperationalConnection(false)).toThrowError(
      "Offline: operative Aktion benötigt eine Serverbestätigung.",
    );
  });

  it("allows the command transport only while online", () => {
    expect(() => assertOperationalConnection(true)).not.toThrow();
  });
});
