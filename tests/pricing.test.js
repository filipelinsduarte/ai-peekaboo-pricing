import { describe, it, expect } from 'vitest';
import PRICING from '../src/pricing.js';

const {
  dataPoints, price, bracketRows, runsPerMonth, minPromptsFor,
  promptsHoldingDataPoints, promptsForDataPoints, toModelCount,
  MODELS, BRACKETS, FREQUENCIES, MIN_PRICE, MAX_PROMPTS
} = PRICING;

const ALL_FREQS = FREQUENCIES.map((f) => f.id);
const ALL_MODEL_COUNTS = [1, 2, 3, 4, 5];

describe('data point formula', () => {
  it('counts 5 AI models', () => {
    expect(MODELS).toBe(5);
  });

  it('maps each frequency to runs per month', () => {
    expect(runsPerMonth('weekly')).toBe(4);
    expect(runsPerMonth('every3')).toBe(10);
    expect(runsPerMonth('alt')).toBe(15);
    expect(runsPerMonth('daily')).toBe(30);
  });

  // These three reproduce the data point counts printed on the live pricing page.
  it('gives 3,000 data points for 1 brand / 40 prompts / every 2 days', () => {
    expect(dataPoints(1, 40, 'alt')).toBe(3000);
  });

  it('gives 6,000 data points for 1 brand / 40 prompts / daily', () => {
    expect(dataPoints(1, 40, 'daily')).toBe(6000);
  });

  it('gives 15,000 data points for 1 brand / 100 prompts / daily', () => {
    expect(dataPoints(1, 100, 'daily')).toBe(15000);
  });

  it('scales linearly with brands', () => {
    expect(dataPoints(3, 100, 'daily')).toBe(45000);
  });

  it('scales linearly with the number of models tracked', () => {
    // 1 brand x 40 prompts x 3 models x 30 runs
    expect(dataPoints(1, 40, 'daily', 3)).toBe(3600);
    // 1 brand x 100 prompts x 1 model x 30 runs
    expect(dataPoints(1, 100, 'daily', 1)).toBe(3000);
  });

  it('clamps prompts up to the floor minimum for the chosen model count', () => {
    // 40 prompts on 1 model daily is below the $29 bundle (min 58 prompts),
    // so it prices as 58, exactly like a below-minimum prompt slider value.
    expect(dataPoints(1, 40, 'daily', 1)).toBe(58 * 30);
  });

  it('defaults to all 5 models when the count is omitted', () => {
    expect(dataPoints(1, 40, 'daily')).toBe(dataPoints(1, 40, 'daily', 5));
  });
});

describe('price anchors at the flat $16.67 rate', () => {
  // Filipe flattened the brackets to one rate on 2026-07-30. The two smaller
  // legacy configs price the same as before (they always sat in the entry
  // bracket); the 100-prompt daily config moved $200 -> $250.
  it('Starter config costs $50/mo', () => {
    expect(price(1, 40, 'alt').monthly).toBe(50);
  });

  it('Peek config costs $100/mo', () => {
    expect(price(1, 40, 'daily').monthly).toBe(100);
  });

  it('Grow config costs $250/mo at the flat rate', () => {
    expect(price(1, 100, 'daily').monthly).toBe(250);
  });

  it('anchors are unchanged when all 5 models are passed explicitly', () => {
    expect(price(1, 40, 'alt', 'monthly', 5).monthly).toBe(50);
    expect(price(1, 40, 'daily', 'monthly', 5).monthly).toBe(100);
    expect(price(1, 100, 'daily', 'monthly', 5).monthly).toBe(250);
  });
});

describe('the single flat bracket', () => {
  it('is exactly one bracket at $16.67 per 1,000, with no upper bound', () => {
    expect(BRACKETS).toHaveLength(1);
    expect(BRACKETS[0].ratePer1k).toBe(16.67);
    expect(BRACKETS[0].upTo).toBe(Infinity);
  });

  it('puts any volume in one row at the flat rate', () => {
    const rows = bracketRows(15000);
    expect(rows).toHaveLength(1);
    expect(rows[0].units).toBe(15000);
    expect(rows[0].ratePer1k).toBe(16.67);
    expect(rows[0].subtotal).toBeCloseTo(250.05, 2);
    expect(rows[0].isLast).toBe(true);

    const small = bracketRows(3000);
    expect(small).toHaveLength(1);
    expect(small[0].units).toBe(3000);
  });

  it('bracket subtotals always sum to the unrounded total', () => {
    for (const dp of [1000, 6000, 15000, 45000, 90000, 250000]) {
      const rows = bracketRows(dp);
      const summed = rows.reduce((acc, r) => acc + r.subtotal, 0);
      expect(summed).toBeCloseTo(price.raw(dp), 6);
    }
  });

  it('bracket units always sum to the total data points', () => {
    for (const dp of [1, 5999, 15000, 61234, 500000]) {
      const rows = bracketRows(dp);
      const units = rows.reduce((acc, r) => acc + r.units, 0);
      expect(units).toBe(dp);
    }
  });

  it('produces zero rows and zero price at zero volume', () => {
    expect(bracketRows(0)).toHaveLength(0);
    expect(price.raw(0)).toBe(0);
  });
});

describe('pricing behaves sanely as you scale', () => {
  it('never gets cheaper when you add a brand', () => {
    let prev = 0;
    for (let brands = 1; brands <= 25; brands++) {
      const p = price(brands, 100, 'daily').monthly;
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  it('never gets cheaper when you add prompts', () => {
    let prev = 0;
    for (let prompts = 20; prompts <= 500; prompts += 10) {
      const p = price(3, prompts, 'daily').monthly;
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  it('never gets cheaper when you track more often', () => {
    const weekly = price(3, 100, 'weekly').monthly;
    const every3 = price(3, 100, 'every3').monthly;
    const alt = price(3, 100, 'alt').monthly;
    const daily = price(3, 100, 'daily').monthly;
    expect(every3).toBeGreaterThan(weekly);
    expect(alt).toBeGreaterThan(every3);
    expect(daily).toBeGreaterThan(alt);
  });

  it('never gets cheaper when you track more models', () => {
    let prev = 0;
    for (const mc of ALL_MODEL_COUNTS) {
      const p = price(3, 100, 'daily', 'monthly', mc).monthly;
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  it('charges the same effective rate at every scale (flat pricing)', () => {
    // Whole-dollar rounding wobbles the effective rate by at most 50 cents
    // spread over the volume; above the floor it must sit on $16.67.
    for (const [brands, prompts] of [[1, 40], [1, 100], [3, 150], [12, 300], [25, 500]]) {
      const p = price(brands, prompts, 'daily');
      expect(p.atFloor).toBe(false);
      expect(Math.abs(p.effectiveRatePer1k - 16.67)).toBeLessThan(0.2);
    }
  });

  it('the monthly price is exactly the flat-rate formula, floored at $29', () => {
    for (const brands of [1, 5, 25]) {
      for (const prompts of [11, 40, 150, 500]) {
        for (const freq of ALL_FREQS) {
          const p = price(brands, prompts, freq);
          expect(p.monthly).toBe(Math.max(MIN_PRICE, Math.round(p.dataPoints * 16.67 / 1000)));
        }
      }
    }
  });
});

describe('yearly billing', () => {
  it('is cheaper per month than monthly billing', () => {
    const m = price(3, 100, 'daily', 'monthly');
    const y = price(3, 100, 'daily', 'yearly');
    expect(y.perMonth).toBeLessThan(m.perMonth);
  });

  it('bills 12x the discounted monthly figure up front', () => {
    const y = price(3, 100, 'daily', 'yearly');
    expect(y.billedNow).toBe(y.perMonth * 12);
  });

  it('charges the full monthly figure when billed monthly', () => {
    const m = price(1, 40, 'daily', 'monthly');
    expect(m.perMonth).toBe(100);
    expect(m.billedNow).toBe(100);
  });
});

describe('choosing which AI models to track', () => {
  it('passes real selections through and caps at 5', () => {
    for (const mc of ALL_MODEL_COUNTS) {
      expect(toModelCount(mc)).toBe(mc);
    }
    expect(toModelCount(7)).toBe(5);
  });

  it('treats junk model input as all 5, never as fewer (no undercharging)', () => {
    // Zero and negatives count as junk: no real selection can produce them.
    for (const bad of [NaN, undefined, null, 'abc', Infinity, 0, -2]) {
      expect(toModelCount(bad)).toBe(MODELS);
    }
  });

  it('tracking fewer models costs less at the same config', () => {
    // 1 brand x 100 prompts daily: 15,000 dp on 5 models -> $250 flat rate.
    const five = price(1, 100, 'daily', 'monthly', 5).monthly;
    const three = price(1, 100, 'daily', 'monthly', 3).monthly;
    const one = price(1, 100, 'daily', 'monthly', 1).monthly;
    expect(five).toBe(250);
    expect(three).toBeLessThan(five);
    expect(one).toBeLessThan(three);
  });

  it('the price at N models equals the price of that data volume', () => {
    for (const mc of ALL_MODEL_COUNTS) {
      const p = price(2, 100, 'daily', 'monthly', mc);
      expect(p.dataPoints).toBe(2 * 100 * mc * 30);
      expect(p.monthly).toBe(Math.max(MIN_PRICE, Math.round(price.raw(p.dataPoints))));
    }
  });

  it('reports the model count it actually used', () => {
    expect(price(1, 40, 'daily', 'monthly', 2).modelCount).toBe(2);
    expect(price(1, 40, 'daily').modelCount).toBe(5);
    expect(price(1, 40, 'daily', 'monthly', 99).modelCount).toBe(5);
  });

  it('needs more prompts to reach the floor as models are removed', () => {
    // Fewer models means each prompt produces less data per run, so the
    // minimum prompt count rises, exactly like less frequent tracking.
    expect(minPromptsFor('daily', 5)).toBe(11);
    expect(minPromptsFor('daily', 3)).toBe(19);
    expect(minPromptsFor('daily', 1)).toBe(58);
    for (const freq of ALL_FREQS) {
      for (let mc = 2; mc <= 5; mc++) {
        expect(minPromptsFor(freq, mc - 1)).toBeGreaterThan(minPromptsFor(freq, mc));
      }
    }
  });

  it('the minimum prompt count never exceeds the prompt slider maximum', () => {
    for (const freq of ALL_FREQS) {
      for (const mc of ALL_MODEL_COUNTS) {
        expect(minPromptsFor(freq, mc)).toBeLessThanOrEqual(MAX_PROMPTS);
      }
    }
  });

  it('switching frequency still holds the price at every model count', () => {
    for (const mc of ALL_MODEL_COUNTS) {
      const expected = price(1, 120, 'daily', 'monthly', mc).monthly;
      for (const to of ALL_FREQS) {
        const prompts = promptsHoldingDataPoints(1, 120, 'daily', to, mc);
        if (prompts === MAX_PROMPTS || prompts === minPromptsFor(to, mc)) continue;
        expect(price(1, prompts, to, 'monthly', mc).monthly).toBe(expected);
      }
    }
  });
});

/* ===========================================================================
   Toggling a model must hold the PRICE steady and move the PROMPT count,
   exactly like a frequency switch (the peec.ai pattern): deselecting a model
   spends the same budget on more prompts across the models that remain. The
   sliders stay the way a customer changes what they pay.
   =========================================================================== */
describe('toggling models holds the price and adjusts prompts', () => {
  it('produces the documented prompt counts for the default config', () => {
    // 1 brand x 40 prompts x 5 models x 30 runs = 6,000 data points.
    expect(promptsHoldingDataPoints(1, 40, 'daily', 'daily', 5, 4)).toBe(50);
    expect(promptsHoldingDataPoints(1, 40, 'daily', 'daily', 5, 2)).toBe(100);
    expect(promptsHoldingDataPoints(1, 40, 'daily', 'daily', 5, 1)).toBe(200);
    expect(promptsHoldingDataPoints(1, 40, 'daily', 'daily', 5, 5)).toBe(40);
  });

  it('holds the data point volume whenever a whole prompt count can express it', () => {
    for (const from of ALL_MODEL_COUNTS) {
      for (const to of ALL_MODEL_COUNTS) {
        const volume = dataPoints(1, 120, 'daily', from);
        const step = 1 * to * runsPerMonth('daily');
        const next = promptsHoldingDataPoints(1, 120, 'daily', 'daily', from, to);
        if (volume % step !== 0 || next === MAX_PROMPTS || next === minPromptsFor('daily', to)) continue;
        expect(dataPoints(1, next, 'daily', to)).toBe(volume);
        expect(price(1, next, 'daily', 'monthly', to).monthly)
          .toBe(price(1, 120, 'daily', 'monthly', from).monthly);
      }
    }
  });

  it('never buys more volume than the customer already had', () => {
    // Prompts are whole numbers; rounding down means any miss is downward,
    // never an upsell — same contract as the frequency switch.
    for (const from of ALL_MODEL_COUNTS) {
      for (const to of ALL_MODEL_COUNTS) {
        for (const prompts of [40, 66, 90, 140, 300]) {
          const volume = dataPoints(2, prompts, 'daily', from);
          const next = promptsHoldingDataPoints(2, prompts, 'daily', 'daily', from, to);
          if (next === minPromptsFor('daily', to)) continue; // low end stop
          expect(dataPoints(2, next, 'daily', to)).toBeLessThanOrEqual(volume);
        }
      }
    }
  });

  it('round trips cleanly when the volume divides evenly', () => {
    // 6,000 dp: 5 models 40 prompts <-> 1 model 200 prompts <-> 2 models 100.
    const down = promptsHoldingDataPoints(1, 40, 'daily', 'daily', 5, 1);
    expect(down).toBe(200);
    expect(promptsHoldingDataPoints(1, down, 'daily', 'daily', 1, 5)).toBe(40);
  });

  it('respects the prompt floor of the target model count', () => {
    // The cheapest 5-model daily plan re-expressed on 1 model must land at or
    // above the 1-model minimum, never below it.
    const out = promptsHoldingDataPoints(1, minPromptsFor('daily', 5), 'daily', 'daily', 5, 1);
    expect(out).toBeGreaterThanOrEqual(minPromptsFor('daily', 1));
  });

  it('clamps at the top of the slider instead of overshooting it', () => {
    // 1 brand x 150 prompts daily on 5 models is 22,500 dp; on 1 model that
    // would need 750 prompts. The slider ends at 500, so the price honestly
    // drops there — no prompt count can buy the same volume.
    const out = promptsHoldingDataPoints(1, 150, 'daily', 'daily', 5, 1);
    expect(out).toBe(MAX_PROMPTS);
  });

  it('holds the price across a combined frequency AND model change', () => {
    // 6,000 dp expressed as weekly on 2 models: 6000 / (2 x 4) = 750 -> capped;
    // use a volume both can express: 1 brand, 60 prompts daily on 4 models =
    // 7,200 dp -> weekly on 3 models needs 7200 / 12 = 600 -> capped too.
    // Take 40 prompts daily on 3 models = 3,600 dp -> alt on 4 models:
    // 3600 / (4 x 15) = 60 prompts exactly.
    const next = promptsHoldingDataPoints(1, 40, 'daily', 'alt', 3, 4);
    expect(next).toBe(60);
    expect(price(1, next, 'alt', 'monthly', 4).monthly)
      .toBe(price(1, 40, 'daily', 'monthly', 3).monthly);
  });

  it('omitting the target model count keeps the source count (old callers)', () => {
    expect(promptsHoldingDataPoints(1, 40, 'daily', 'weekly', 3))
      .toBe(promptsHoldingDataPoints(1, 40, 'daily', 'weekly', 3, 3));
  });

  it('treats junk in either model argument as all 5', () => {
    for (const bad of [NaN, 'abc', Infinity, 0]) {
      expect(promptsHoldingDataPoints(1, 40, 'daily', 'daily', bad, bad))
        .toBe(promptsHoldingDataPoints(1, 40, 'daily', 'daily', 5, 5));
    }
  });
});

/* ===========================================================================
   promptsForDataPoints re-expresses a REMEMBERED budget at any configuration.
   The UI stores the volume the customer chose with the sliders and calls this
   on every model/frequency toggle, so chained toggles never accumulate
   rounding drift: 5 -> 4 -> 3 -> 2 -> 1 models lands exactly where a direct
   5 -> 1 jump does, and every toggle path round trips.
   =========================================================================== */
describe('re-expressing a stored volume at any configuration', () => {
  it('produces the documented prompt counts for a 6,000 dp budget', () => {
    expect(promptsForDataPoints(6000, 1, 'daily', 5)).toBe(40);
    expect(promptsForDataPoints(6000, 1, 'daily', 4)).toBe(50);
    expect(promptsForDataPoints(6000, 1, 'daily', 3)).toBe(66);
    expect(promptsForDataPoints(6000, 1, 'daily', 2)).toBe(100);
    expect(promptsForDataPoints(6000, 1, 'daily', 1)).toBe(200);
    expect(promptsForDataPoints(6000, 1, 'weekly', 5)).toBe(300);
  });

  it('is immune to toggle order: any chain equals the direct jump', () => {
    // Walking 5 -> 4 -> 3 -> 2 -> 1 against the same stored budget gives the
    // same answer as jumping straight to 1, because every step re-derives
    // from the budget instead of the previous step's rounded result.
    const budget = dataPoints(1, 40, 'daily', 5);
    let chained;
    for (const mc of [4, 3, 2, 1]) {
      chained = promptsForDataPoints(budget, 1, 'daily', mc);
    }
    expect(chained).toBe(promptsForDataPoints(budget, 1, 'daily', 1));
    expect(chained).toBe(200);
  });

  it('round trips exactly through any model path', () => {
    const budget = dataPoints(1, 40, 'daily', 5);
    for (const detour of ALL_MODEL_COUNTS) {
      promptsForDataPoints(budget, 1, 'daily', detour); // the detour
      expect(promptsForDataPoints(budget, 1, 'daily', 5)).toBe(40);
    }
  });

  it('agrees with the pairwise conversion on a single step', () => {
    for (const from of ALL_MODEL_COUNTS) {
      for (const to of ALL_MODEL_COUNTS) {
        const budget = dataPoints(1, 90, 'daily', from);
        expect(promptsForDataPoints(budget, 1, 'daily', to))
          .toBe(promptsHoldingDataPoints(1, 90, 'daily', 'daily', from, to));
      }
    }
  });

  it('clamps to the prompt floor and the slider top', () => {
    // Tiny budget on 1 model daily: floor is 58 prompts.
    expect(promptsForDataPoints(100, 1, 'daily', 1)).toBe(minPromptsFor('daily', 1));
    // Huge budget on 1 model daily: 22,500 dp needs 750 prompts -> 500 cap.
    expect(promptsForDataPoints(22500, 1, 'daily', 1)).toBe(MAX_PROMPTS);
  });

  it('uses the brand-aware prompt floor', () => {
    // A 25-brand weekly budget of 1,500 dp is exactly 3 prompts, and a
    // too-small budget clamps to the 25-brand floor (3), not the 1-brand 87.
    expect(promptsForDataPoints(1500, 25, 'weekly', 5)).toBe(3);
    expect(promptsForDataPoints(100, 25, 'weekly', 5)).toBe(minPromptsFor('weekly', 5, 25));
    expect(minPromptsFor('weekly', 5, 25)).toBe(3);
  });

  it('returns the floor for junk budgets, never NaN', () => {
    for (const bad of [NaN, undefined, null, 'abc', -5, 0]) {
      const out = promptsForDataPoints(bad, 1, 'daily', 5);
      expect(out).toBe(minPromptsFor('daily', 5));
    }
  });
});

describe('the $29 floor', () => {
  it('is $29', () => {
    expect(MIN_PRICE).toBe(29);
  });

  it('is the exact price of the cheapest plan at EVERY tracking frequency', () => {
    for (const freq of ALL_FREQS) {
      const cheapest = price(1, minPromptsFor(freq), freq);
      expect(cheapest.monthly).toBe(29);
    }
  });

  it('is the exact price of the cheapest plan at EVERY model count too', () => {
    for (const freq of ALL_FREQS) {
      for (const mc of ALL_MODEL_COUNTS) {
        const fewest = minPromptsFor(freq, mc);
        expect(price(1, fewest, freq, 'monthly', mc).monthly).toBe(29);
      }
    }
  });

  it('needs FEWER prompts per brand as brands are added', () => {
    // Each prompt is checked for every brand, so 25 brands squeeze 25x the
    // data out of each prompt. The $29 bundle (1,740 dp) on 25 brands at
    // weekly x 5 models is 1740 / (25 x 5 x 4) = 3 prompts, not 87.
    expect(minPromptsFor('weekly', 5, 25)).toBe(3);
    expect(minPromptsFor('weekly', 5, 5)).toBe(17);
    expect(minPromptsFor('alt', 5, 25)).toBe(1);
    for (const freq of ALL_FREQS) {
      for (const brands of [2, 5, 10, 25]) {
        expect(minPromptsFor(freq, 5, brands)).toBeLessThanOrEqual(minPromptsFor(freq, 5, 1));
      }
    }
  });

  it('prices the 25-brand weekly minimum at exactly $29', () => {
    // 25 brands x 3 prompts x 5 models x 4 runs = 1,500 dp -> $25 metered,
    // floored to $29. The scenario Filipe reported as broken.
    const minP = minPromptsFor('weekly', 5, 25);
    const p = price(25, minP, 'weekly');
    expect(minP).toBe(3);
    expect(p.monthly).toBe(29);
    expect(p.atFloor).toBe(true);
    expect(p.minPrompts).toBe(3);
  });

  it('never goes below 1 prompt even when brands alone exceed the bundle', () => {
    // 25 brands daily x 5 models: one prompt is already 3,750 dp (> 1,740),
    // so the minimum is 1 prompt and the price is honestly above $29.
    expect(minPromptsFor('daily', 5, 25)).toBe(1);
    expect(price(25, 1, 'daily').monthly).toBeGreaterThan(29);
  });

  it('reaches exactly $29 wherever one prompt does not already exceed the bundle', () => {
    for (const freq of ALL_FREQS) {
      for (const mc of ALL_MODEL_COUNTS) {
        for (const brands of [1, 2, 5, 10, 25]) {
          const perPrompt = brands * mc * runsPerMonth(freq);
          if (perPrompt > 1740) continue; // 1 prompt overshoots; floor unreachable
          const p = price(brands, minPromptsFor(freq, mc, brands), freq, 'monthly', mc);
          expect(p.monthly).toBe(29);
        }
      }
    }
  });

  it('omitting brands keeps the single-brand minimums (old callers)', () => {
    for (const freq of ALL_FREQS) {
      expect(minPromptsFor(freq, 5)).toBe(minPromptsFor(freq, 5, 1));
      expect(minPromptsFor(freq)).toBe(minPromptsFor(freq, 5, 1));
    }
  });

  it('needs more prompts to reach $29 as tracking gets less frequent', () => {
    // Fewer runs per month means each prompt produces less data, so the
    // minimum prompt count has to rise to still clear the floor.
    expect(minPromptsFor('daily')).toBe(11);
    expect(minPromptsFor('alt')).toBe(23);
    expect(minPromptsFor('every3')).toBe(34);
    expect(minPromptsFor('weekly')).toBe(87);

    expect(minPromptsFor('weekly')).toBeGreaterThan(minPromptsFor('every3'));
    expect(minPromptsFor('every3')).toBeGreaterThan(minPromptsFor('alt'));
    expect(minPromptsFor('alt')).toBeGreaterThan(minPromptsFor('daily'));
  });

  it('cannot be undercut by ANY combination of the four inputs', () => {
    for (const freq of ALL_FREQS) {
      for (const mc of ALL_MODEL_COUNTS) {
        for (let brands = 1; brands <= 25; brands += 4) {
          for (let prompts = 1; prompts <= 200; prompts += 7) {
            expect(price(brands, prompts, freq, 'monthly', mc).monthly).toBeGreaterThanOrEqual(29);
          }
        }
      }
    }
  });

  it('clamps a prompt count below the frequency minimum up to that minimum', () => {
    // Asking for 5 prompts on weekly (min 87) must be treated as 87.
    const asked = price(1, 5, 'weekly');
    const floorPlan = price(1, minPromptsFor('weekly'), 'weekly');
    expect(asked.prompts).toBe(87);
    expect(asked.dataPoints).toBe(floorPlan.dataPoints);
  });

  it('does not drag down any price that already clears the floor', () => {
    // The anchor plans sit above $29 and must be untouched by it.
    expect(price(1, 40, 'alt').monthly).toBe(50);
    expect(price(1, 40, 'daily').monthly).toBe(100);
    expect(price(1, 100, 'daily').monthly).toBe(250);
  });

  it('flags when the floor is what set the price, so the UI can explain it', () => {
    expect(price(1, minPromptsFor('daily'), 'daily').atFloor).toBe(true);
    expect(price(1, 100, 'daily').atFloor).toBe(false);
  });
});

describe('the book-a-meeting threshold', () => {
  it('is $600 of monthly list price', () => {
    expect(PRICING.BOOK_MEETING_FROM).toBe(600);
  });

  it('stays on the trial CTA below $600', () => {
    expect(price(1, 40, 'daily').bookMeeting).toBe(false);
    expect(price(1, 100, 'daily').bookMeeting).toBe(false);
    // 1 brand x 239 prompts daily = 35,850 dp -> $598, under the line.
    expect(price(1, 239, 'daily').monthly).toBe(598);
    expect(price(1, 239, 'daily').bookMeeting).toBe(false);
  });

  it('flips to book-a-meeting at $600 and above', () => {
    // 2 brands x 120 prompts daily = 36,000 dp -> exactly $600.
    expect(price(2, 120, 'daily').monthly).toBe(600);
    expect(price(2, 120, 'daily').bookMeeting).toBe(true);
    expect(price(25, 200, 'daily').bookMeeting).toBe(true);
  });

  it('keys on the monthly LIST price, so the yearly toggle cannot flip it', () => {
    // The yearly discount shows a lower per-month figure, but a plan this
    // size is still a sales conversation either way.
    const y = price(2, 120, 'daily', 'yearly');
    expect(y.perMonth).toBeLessThan(600);
    expect(y.bookMeeting).toBe(true);
  });

  it('always equals monthly >= threshold across a config sweep', () => {
    for (const brands of [1, 5, 12, 25]) {
      for (const prompts of [11, 40, 150, 500]) {
        for (const freq of ALL_FREQS) {
          const p = price(brands, prompts, freq);
          expect(p.bookMeeting).toBe(p.monthly >= PRICING.BOOK_MEETING_FROM);
        }
      }
    }
  });
});

describe('bad input cannot produce a bad price', () => {
  it('clamps brands and prompts below the minimum', () => {
    expect(price(0, 0, 'daily').monthly).toBe(price(1, minPromptsFor('daily'), 'daily').monthly);
    expect(price(-5, -100, 'daily').monthly).toBe(price(1, minPromptsFor('daily'), 'daily').monthly);
  });

  it('survives NaN, undefined and string input without returning NaN', () => {
    for (const bad of [NaN, undefined, null, 'abc', Infinity]) {
      const p = price(bad, bad, 'daily', 'monthly', bad);
      expect(Number.isFinite(p.monthly)).toBe(true);
      expect(p.monthly).toBeGreaterThan(0);
    }
  });

  it('falls back to a known frequency when given an unknown one', () => {
    expect(runsPerMonth('fortnightly')).toBe(30);
    expect(Number.isFinite(price(1, 40, 'nonsense').monthly)).toBe(true);
  });

  it('rounds the displayed price to whole dollars', () => {
    const p = price(7, 130, 'alt');
    expect(Number.isInteger(p.monthly)).toBe(true);
  });
});

/* ===========================================================================
   Changing tracking frequency must hold the PRICE steady and move the PROMPT
   count instead. These guard that contract, because a regression here is a
   wrong number on screen, not a crash.
   =========================================================================== */
describe('switching frequency holds the price and adjusts prompts', () => {
  it('keeps the price identical across every frequency pair', () => {
    const brands = 1;
    const startPrompts = 40;
    const startFreq = 'daily';
    const expected = price(brands, startPrompts, startFreq).monthly;

    for (const to of ALL_FREQS) {
      const prompts = promptsHoldingDataPoints(brands, startPrompts, startFreq, to);
      expect(price(brands, prompts, to).monthly).toBe(expected);
    }
  });

  it('produces the documented prompt counts for the default config', () => {
    // 1 brand x 40 prompts x 5 models x 30 runs = 6,000 data points.
    expect(promptsHoldingDataPoints(1, 40, 'daily', 'weekly')).toBe(300);
    expect(promptsHoldingDataPoints(1, 40, 'daily', 'every3')).toBe(120);
    expect(promptsHoldingDataPoints(1, 40, 'daily', 'alt')).toBe(80);
    expect(promptsHoldingDataPoints(1, 40, 'daily', 'daily')).toBe(40);
  });

  it('holds the data point volume, which is what holds the price', () => {
    const before = dataPoints(2, 60, 'alt');
    const prompts = promptsHoldingDataPoints(2, 60, 'alt', 'daily');
    expect(dataPoints(2, prompts, 'daily')).toBe(before);
  });

  // The prompt slider has end stops that do not move with the brand count, so
  // a volume can sit outside what a given frequency can express. Everywhere
  // in between, the price is held exactly.
  function atEndStop(prompts, freq) {
    return prompts === minPromptsFor(freq) || prompts === MAX_PROMPTS;
  }

  it('holds the price exactly whenever a whole prompt count can express it', () => {
    for (const brands of [1, 3, 7, 12]) {
      for (const prompts of [15, 40, 90, 140, 300]) {
        for (const from of ALL_FREQS) {
          const was = price(brands, prompts, from).monthly;
          const volume = dataPoints(brands, prompts, from);
          for (const to of ALL_FREQS) {
            const step = brands * MODELS * runsPerMonth(to);
            const next = promptsHoldingDataPoints(brands, prompts, from, to);
            // Only assert where the volume divides evenly and no end stop bites.
            if (volume % step !== 0 || atEndStop(next, to)) continue;
            expect(price(brands, next, to).monthly).toBe(was);
          }
        }
      }
    }
  });

  it('never buys more volume than the customer already had', () => {
    // Prompts are whole numbers, so an exact landing is not always possible.
    // Rounding down means any miss is downward, never an upsell.
    for (const brands of [1, 3, 7, 12]) {
      for (const prompts of [15, 40, 90, 140, 300]) {
        for (const from of ALL_FREQS) {
          const volume = dataPoints(brands, prompts, from);
          for (const to of ALL_FREQS) {
            const next = promptsHoldingDataPoints(brands, prompts, from, to);
            if (next === minPromptsFor(to)) continue; // low end stop, documented below
            expect(dataPoints(brands, next, to)).toBeLessThanOrEqual(volume);
          }
        }
      }
    }
  });

  it('lands within a single prompt of the original volume', () => {
    // The tightest a whole-number prompt count can get. This is what bounds
    // the price drift to a rounding step rather than anything meaningful.
    for (const brands of [1, 3, 7, 12]) {
      for (const prompts of [15, 40, 90, 140, 300]) {
        for (const from of ALL_FREQS) {
          const volume = dataPoints(brands, prompts, from);
          for (const to of ALL_FREQS) {
            const next = promptsHoldingDataPoints(brands, prompts, from, to);
            if (atEndStop(next, to)) continue;
            const step = brands * MODELS * runsPerMonth(to);
            expect(volume - dataPoints(brands, next, to)).toBeLessThan(step);
          }
        }
      }
    }
  });

  it('only ever costs MORE at the low end stop, never from the arithmetic', () => {
    for (const brands of [1, 3, 7, 12]) {
      for (const prompts of [15, 40, 90, 140, 300]) {
        for (const from of ALL_FREQS) {
          const was = price(brands, prompts, from).monthly;
          for (const to of ALL_FREQS) {
            const next = promptsHoldingDataPoints(brands, prompts, from, to);
            const now = price(brands, next, to).monthly;
            if (now > was) expect(next).toBe(minPromptsFor(to));
          }
        }
      }
    }
  });

  it('round trips back to the original prompt count', () => {
    for (const from of ALL_FREQS) {
      for (const to of ALL_FREQS) {
        const out = promptsHoldingDataPoints(1, 40, 'daily', from);
        const back = promptsHoldingDataPoints(1, out, from, to);
        const home = promptsHoldingDataPoints(1, back, to, 'daily');
        expect(home).toBe(40);
      }
    }
  });

  it('holds the floor plan at exactly the minimum price', () => {
    // The cheapest weekly plan converted to daily is still the cheapest plan.
    const weeklyFloor = minPromptsFor('weekly');
    expect(price(1, weeklyFloor, 'weekly').monthly).toBe(MIN_PRICE);

    const asDaily = promptsHoldingDataPoints(1, weeklyFloor, 'weekly', 'daily');
    expect(asDaily).toBe(minPromptsFor('daily'));
    expect(price(1, asDaily, 'daily').monthly).toBe(MIN_PRICE);
  });

  it('never returns fewer prompts than the target frequency allows', () => {
    for (const to of ALL_FREQS) {
      const out = promptsHoldingDataPoints(1, 15, 'daily', to);
      expect(out).toBeGreaterThanOrEqual(minPromptsFor(to));
    }
  });

  it('clamps at the top of the slider instead of overshooting it', () => {
    // 1 brand x 100 prompts daily is 15,000 dp; weekly would need 750 prompts.
    const out = promptsHoldingDataPoints(1, 100, 'daily', 'weekly');
    expect(out).toBe(MAX_PROMPTS);
    expect(out).toBeLessThanOrEqual(MAX_PROMPTS);
  });

  it('always returns a finite whole number, even for junk input', () => {
    for (const bad of [NaN, undefined, null, 'abc', Infinity, -5]) {
      const out = promptsHoldingDataPoints(bad, bad, 'daily', 'weekly');
      expect(Number.isInteger(out)).toBe(true);
      expect(out).toBeGreaterThan(0);
    }
  });

  it('falls back safely when the target frequency is unknown', () => {
    const out = promptsHoldingDataPoints(1, 40, 'daily', 'fortnightly');
    expect(Number.isInteger(out)).toBe(true);
    expect(price(1, out, 'fortnightly').monthly).toBe(price(1, 40, 'daily').monthly);
  });
});
