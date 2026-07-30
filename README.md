# AI Peekaboo Pricing

The live pricing page for [AI Peekaboo](https://www.aipeekaboo.com): one plan, an interactive calculator, and a flat usage rate. The whole deliverable is a single self-contained `index.html` (all logos, fonts and logic inlined), published with GitHub Pages.

**Live page:** https://filipelinsduarte.github.io/ai-peekaboo-pricing/

---

## How the repo is organised

| Path | What it is |
|---|---|
| `index.html` | The page. Self-contained, deployable as a single file. |
| `src/pricing.js` | The pricing engine. Pure logic, no DOM. The single source of truth for every number on the page. |
| `tests/pricing.test.js` | 86 Vitest tests. This suite is the QA for the pricing math. |
| `build.mjs` | Inlines `src/pricing.js` into `index.html` between the `/* build:pricing */` markers. |

The engine runs in two places from one file: Node (via `module.exports`, for the tests) and the browser (via `window.PRICING`, inlined by the build). Never hand-edit the code between the build markers in `index.html`, the build overwrites it.

```bash
npm install        # once
npm test           # run the 86-test suite
npm run build      # re-inline src/pricing.js into index.html
npm run serve      # local server on http://127.0.0.1:7898
```

**To change any price:** edit the CONFIG block at the top of `src/pricing.js`, then run `npm test && npm run build`. If a change breaks a promise the page makes (the anchor prices, the floor, the hold-the-price contracts), tests go red before a customer ever sees it.

---

## The pricing model, in detail

### 1. The billing unit: the data point

One **data point** is one prompt, checked on one AI model, on one run. It is the only unit anything is billed on.

```
data points per month = brands x prompts x models tracked x runs per month
```

Runs per month by tracking frequency:

| Frequency | Runs per month |
|---|---|
| Weekly | 4 |
| Every 3 days | 10 |
| Every 2 days | 15 |
| Daily | 30 |

The five trackable surfaces are ChatGPT, Gemini, Perplexity, Google AI Overviews and Google AI Mode. Customers choose which of them to track (1 to 5), and the count multiplies straight into the formula.

Example: 1 brand x 40 prompts x 5 models x daily (30 runs) = **6,000 data points a month**.

### 2. One flat rate: $16.67 per 1,000 data points

Every data point costs the same, at any volume. There are no tiers, no volume brackets, no blended averages.

```
monthly price = max($29, round(data points x 16.67 / 1000))
```

Worked examples (these exact rows render in tests):

| Data points / month | Configuration | Price |
|---|---|---|
| 3,000 | 1 brand, 40 prompts, every 2 days | $50 |
| 6,000 | 1 brand, 40 prompts, daily | $100 |
| 15,000 | 1 brand, 100 prompts, daily | $250 |
| 36,000 | 2 brands, 120 prompts, daily | $600 |
| 60,000 | 4 brands, 100 prompts, daily | $1,000 |

Implementation note: the engine still models the rate as a bracket list (`BRACKETS`), it simply holds a single `{ upTo: Infinity, ratePer1k: 16.67 }` entry. The structure survived the 2026-07-30 flattening of the old graduated brackets so the engine, the UI and the tests kept one shape.

### 3. The $29 floor, and why the minimum prompt count moves

No configuration can cost less than **$29 a month**. The floor is implemented as a fixed bundle of data points:

```
MIN_DATA_POINTS = 1740        (which is $29 at $16.67 per 1,000)
minimum prompts = floor(1740 / (brands x models x runs per month)), never below 1
```

$29 buys the same amount of data for everyone. How you spend it is your choice, which is why the minimum prompt count is a function of all three other inputs:

* **Less frequent tracking** squeezes less data from each prompt, so the minimum rises. At 1 brand and 5 models: 11 prompts daily, 23 every 2 days, 34 every 3 days, 87 weekly.
* **Fewer models** works the same way. 1 model daily needs 58 prompts to reach the bundle; 1 model weekly needs 435.
* **More brands** works in reverse: every prompt runs for every brand, so each prompt yields more data and the minimum falls. 25 brands on weekly bottoms out at just 3 prompts, still exactly $29.

The floor is deliberately reached by rounding the minimum prompt count **down**, which lands the raw price just under $29 so the floor is what sets it. Every cheapest plan reads exactly $29, never $30-something.

Honest edge: at high volume-per-prompt configurations (for example 25 brands, daily, 5 models) a single prompt already exceeds the 1,740-point bundle. The minimum clamps at 1 prompt and the price sits truthfully above the floor ($63 in that case). The page never fakes a $29 that the math cannot deliver.

### 4. The hold-the-price contract (frequency and model toggles)

Changing tracking frequency, or toggling a model on or off, **never changes the price**. Someone picking weekly, or dropping Perplexity, is choosing how the same budget gets spent, not asking to pay less. Paying less is what the sliders are for.

Mechanics:

* The UI remembers the customer's chosen budget in data points (`volumeTarget`). Only a slider move (brands or prompts) re-sets it.
* Every frequency or model toggle re-derives the prompt count from that stored budget: `prompts = floor(volumeTarget / (brands x models x runs))`, clamped to the current minimum and the 500-prompt slider maximum.
* Deriving from the stored budget instead of the previous toggle's result means chained toggles never accumulate rounding drift. Walking 5 models down to 1 one chip at a time lands on exactly the same prompt count as jumping straight to 1, and every toggle path round trips exactly.
* Rounding is always **down**, so an inexact conversion can only ever land at or below the previous price, never above it. No accidental upsell.
* Slider end stops are honest: if no prompt count within 11 to 500 can express the stored budget at the new configuration (for example a huge daily budget re-expressed on 1 model), the count clamps and the price genuinely moves. Because the stored budget survives the clamp, restoring the old configuration restores the old price exactly.

Example, all at $100: 1 brand, 40 prompts, daily, 5 models (6,000 dp) becomes 80 prompts on every-2-days, 300 prompts on weekly, 50 prompts on 4 models, 200 prompts on 1 model.

### 5. The book-a-meeting threshold: $600 a month

From **$600 of monthly list price** upward, the card swaps the self-serve trial CTA (purple, "Start 14-day free trial", links to signup) for a dark "Book a meeting" CTA linking to Calendly, with matching microcopy. The constant is `BOOK_MEETING_FROM` in the engine and the flag is `price(...).bookMeeting`.

It keys on the undiscounted **monthly list price**, so a billing-period discount can never flip the CTA back and forth: a plan that size is a sales conversation on any billing period. Boundary anchors in tests: 1 brand x 239 prompts daily is $598 and stays self-serve; 2 brands x 120 prompts daily is exactly $600 and books a meeting.

### 6. Yearly billing (engine-supported, currently not exposed)

The engine supports yearly billing at 2 months free (pay for 10, get 12): `price(brands, prompts, freq, 'yearly', models)` returns the discounted per-month figure, the amount billed now and the saving. The current page sells monthly only (the toggle was removed by design), but the logic and its tests remain, so re-exposing it is a UI change, not an engine change.

### 7. Bad input can never produce a bad price

Every entry point coerces its inputs before they reach the math:

* `toCount` turns NaN, Infinity, strings, negatives and fractions into a sane whole number at or above the minimum.
* `toModelCount` clamps the model count into 1 to 5, and treats junk (including 0 and negatives, which no real selection can produce) as **all 5 models**. The safe failure is charging for everything, never silently undercharging.
* Unknown frequency ids fall back to daily.
* The displayed price is always a whole-dollar integer.

---

## What the test suite guards

`npm test` runs 86 assertions across:

* **Anchors:** the flat-rate reference prices ($50 / $100 / $250) can never drift.
* **Monotonicity:** more brands, more prompts, more models or more frequent tracking never gets cheaper.
* **Flat rate:** the effective rate sits on $16.67 per 1,000 at every scale (within whole-dollar rounding), and the monthly price always equals the flat-rate formula floored at $29.
* **The floor:** exactly $29 at every frequency x model-count x brand-count combination where one prompt fits the bundle, unreachable-floor cases stay honest, and the frequency-dependent minimums are pinned.
* **Hold-the-price:** frequency switches and model toggles preserve the price wherever a whole prompt count can express the volume, never buy more volume than the customer had, land within one prompt of the original volume, are immune to toggle order, and round trip.
* **CTA threshold:** $598 stays trial, $600 books a meeting, the yearly toggle cannot flip it, and the flag always equals `monthly >= 600` across a config sweep.
* **Input safety:** junk in any argument yields a finite, floored, whole-dollar price.

---

## Page anatomy

Single file, top to bottom: fixed nav (aipeekaboo.com replica), hero with the trusted-by strip and G2 badge, the pricing card (static summary panel on the left, the interactive configurator on the right), How it works, API + MCP, testimonials, FAQ, final CTA, footer (aipeekaboo.com replica). Sections are framed by the CrowdReply-style rail grid, and scroll-reveal is a small IntersectionObserver.

The UI layer follows defensive single-file rules: guarded DOM lookups, per-step boot try/catch, delegated event handlers, no inline `onclick`, and all brand marks inlined as data URIs so the page renders identically offline.
