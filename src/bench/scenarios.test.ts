import { describe, expect, it } from 'vitest';
import { SCENARIOS, type ScenarioCtx } from './scenarios';
import { createBenchHost } from './session';

// Every bench script must really play its game against the core reducer (no scene mounted here,
// so nothing reports SETTLED; the scripts' own fallbacks cover the spinners). A virtual clock
// stands in for the 6 s window.
describe('bench scenarios', () => {
  it('covers all 13 games once', () => {
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(13);
  });

  for (const sc of SCENARIOS) {
    it(`${sc.id}: the script's actions are accepted`, { timeout: 20_000 }, async () => {
      const host = createBenchHost({
        gameId: sc.id,
        seed: 7,
        rules: sc.rules,
        content: sc.content?.(),
      });
      let clock = 0;
      const windowMs = 6000;
      const ctx: ScenarioCtx = {
        host,
        view: <V>() => host.getView() as V,
        elapsed: () => clock,
        done: () => clock >= windowMs,
        lastAction: windowMs - 1700,
        sleep: async (ms) => {
          clock += ms;
          return clock < windowMs;
        },
      };
      await sc.run(ctx);
      expect(host.stats.accepted).toBeGreaterThan(0);
    });
  }
});
