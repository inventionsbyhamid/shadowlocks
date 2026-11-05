import { describe, expect, it } from "vitest";
import { FlashBudget, MIN_GAP_S } from "../../src/render/fx/flash-budget";

describe("flash budget", () => {
  it("never allows more than 3 flashes a second, however often sources ask", () => {
    const b = new FlashBudget();
    let granted = 0;
    for (let f = 0; f < 90; f++) {
      b.step(1 / 90);
      for (let s = 0; s < 4; s++) if (b.take()) granted++;
    }
    expect(granted).toBeLessThanOrEqual(3);
    expect(granted).toBeGreaterThanOrEqual(2);
    expect(MIN_GAP_S).toBeGreaterThan(1 / 3);
  });

  it("refuses a flash until the gap has passed, and reset forgets the last one", () => {
    const b = new FlashBudget();
    expect(b.take()).toBe(true);
    b.step(MIN_GAP_S / 2);
    expect(b.take()).toBe(false);
    b.step(MIN_GAP_S / 2 + 1e-6);
    expect(b.take()).toBe(true);
    b.reset();
    expect(b.started).toBe(0);
    expect(b.take()).toBe(true);
  });
});
