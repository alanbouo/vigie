import { describe, expect, it } from "vitest";
import { SlidingWindowLimiter } from "../src/rateLimit.js";

describe("rate-limit du quick audit public (§9)", () => {
  it("autorise jusqu'au plafond puis bloque", () => {
    const limiter = new SlidingWindowLimiter(3, 1000);
    const t = 0;
    expect(limiter.allow("ip1", t)).toBe(true);
    expect(limiter.allow("ip1", t + 1)).toBe(true);
    expect(limiter.allow("ip1", t + 2)).toBe(true);
    expect(limiter.allow("ip1", t + 3)).toBe(false);
    // Une autre IP n'est pas affectée.
    expect(limiter.allow("ip2", t + 3)).toBe(true);
  });

  it("la fenêtre glisse : les vieux hits expirent", () => {
    const limiter = new SlidingWindowLimiter(2, 1000);
    expect(limiter.allow("ip", 0)).toBe(true);
    expect(limiter.allow("ip", 100)).toBe(true);
    expect(limiter.allow("ip", 200)).toBe(false);
    expect(limiter.allow("ip", 1150)).toBe(true); // le hit à t=0 est sorti
  });
});
