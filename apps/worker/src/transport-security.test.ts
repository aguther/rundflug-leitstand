import { describe, expect, it } from "vitest";
import { httpsRedirectLocation } from "./transport-security";

describe("transport security", () => {
  it("redirects an acceptance HTTP request to the same HTTPS resource", () => {
    expect(
      httpsRedirectLocation("http://rundflug-leitstand.example/api/health?probe=tls", "acceptance"),
    ).toBe("https://rundflug-leitstand.example/api/health?probe=tls");
  });

  it("keeps HTTPS and local development requests unchanged", () => {
    expect(
      httpsRedirectLocation("https://rundflug-leitstand.example/api/health", "acceptance"),
    ).toBeNull();
    expect(httpsRedirectLocation("http://127.0.0.1:8787/api/health", "development")).toBeNull();
  });
});
