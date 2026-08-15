import { afterEach, describe, expect, it, vi } from "vitest";
import { loginOperator } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("V1.2 account login", () => {
  it("authenticates without a browser-generated device ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          authenticated: true,
          account: {
            id: "550e8400-e29b-41d4-a716-446655440000",
            loginCode: "FL-01",
            role: "FLIGHT_LINE",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await loginOperator("550e8400-e29b-41d4-a716-446655440000", "123456");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({
        body: JSON.stringify({
          accountId: "550e8400-e29b-41d4-a716-446655440000",
          pin: "123456",
        }),
      }),
    );
  });
});
