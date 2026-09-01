import { describe, expect, it } from "vitest";

describe("external integration credentials", () => {
  it("accepts the Stibee access token", async () => {
    const token = process.env.STIBEE_API_KEY;
    expect(token, "STIBEE_API_KEY must be configured").toBeTruthy();
    const response = await fetch("https://api.stibee.com/v2/auth-check", {
      headers: { AccessToken: token as string },
    });
    expect(response.status, await response.text()).not.toBe(401);
    expect(response.status).toBeLessThan(500);
  }, 15_000);
});
