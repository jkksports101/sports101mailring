import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";

describe("target audience foundation", () => {
  it("registers a protected target list procedure", () => {
    const routerShape = appRouter._def.record as Record<string, unknown>;
    expect(routerShape.targets).toBeDefined();
    const targetsShape = routerShape.targets as { list?: unknown };
    expect(targetsShape.list).toBeDefined();
    expect(typeof targetsShape.list).toBe("function");
  });
});
