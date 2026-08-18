/* ===========================================================================
   AI Peekaboo pricing engine (pure logic, no DOM).
   Single source of truth for every number on the pricing page.

   Runs in Node (module.exports, for the Vitest suite) and in the browser
   (window.PRICING, inlined into index.html by build.mjs).

   TO CHANGE PRICING: edit the CONFIG block below, then run:
       npm test && npm run build
   =========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PRICING = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------------------- CONFIG ---------------------------------- */

  // The five AI surfaces available. Customers choose which of them to track;
  // the price scales with how many they pick.
  var MODEL_NAMES = [
    'ChatGPT',
    'Gemini',
    'Perplexity',
    'Google AI Overviews',
    'Google AI Mode'
  ];
  var MODELS = MODEL_NAMES.length;

  var FREQUENCIES = [
    { id: 'weekly', label: 'Weekly', runsPerMonth: 4 },
    { id: 'every3', label: 'Every 3 days', runsPerMonth: 10 },
    { id: 'alt', label: 'Every 2 days', runsPerMonth: 15 },
    { id: 'daily', label: 'Daily', runsPerMonth: 30 }
  ];
  var DEFAULT_FREQUENCY = 'daily';

  // One flat rate per 1,000 data points, at any volume (Filipe flattened the
  // graduated brackets on 2026-07-30). The bracket structure stays so the
  // engine, the receipt breakdown and the tests keep one shape — there is
  // simply a single bracket now.
  //
  //    3,000 dp -> $50   (1 brand,  40 prompts, 5 models, every 2 days)
  //    6,000 dp -> $100  (1 brand,  40 prompts, 5 models, daily)
  //   15,000 dp -> $250  (1 brand, 100 prompts, 5 models, daily)
  var BRACKETS = [
    { upTo: Infinity, ratePer1k: 16.67 }
  ];

  // Annual billing takes 15% off the monthly figure, paid up front for 12
  // months (Filipe switched from 2-months-free to a flat 15% on 2026-08-18).
  var ANNUAL_DISCOUNT = 0.15;

  // From this monthly LIST price up, the plan includes the premium reporting
  // features (Looker Studio integration, white label client reporting). Keyed
  // on the undiscounted monthly figure, same as BOOK_MEETING_FROM, so the
  // annual toggle cannot flip a feature in and out.
  var PREMIUM_FEATURES_FROM = 100;

  // From this monthly LIST price up, the page swaps the self-serve trial CTA
  // for "Book a meeting". Keyed on the undiscounted monthly figure so the
  // yearly toggle cannot flip the CTA back and forth — a plan this size is a
  // sales conversation on either billing period.
  var BOOK_MEETING_FROM = 600;

  // The floor. No configuration of the four inputs can cost less than this.
  //
  // $29 buys a fixed bundle of data points (MIN_DATA_POINTS, which is $29 at
  // the entry bracket rate of $16.67 per 1,000). How you SPEND that bundle is
  // the customer's choice: a few prompts checked daily on every model, or many
  // more prompts checked weekly on one. Less frequent tracking and fewer
  // models both squeeze less data out of each prompt, so either takes MORE
  // prompts to reach the floor. That is why the prompt minimum below is a
  // function of frequency and model count, not a constant.
  var MIN_PRICE = 29;
  var MIN_DATA_POINTS = 1740;

  // Slider bounds. Past MAX_BRANDS we point people at sales.
  var MIN_BRANDS = 1;
  var MAX_BRANDS = 25;
  var MAX_PROMPTS = 500;
  var PROMPT_STEP = 1;

  /* ---------------------------- HELPERS --------------------------------- */

  // Coerce anything (NaN, undefined, "abc", Infinity, a negative) into a sane
  // whole number at or above `min`. A bad input must never reach the brackets.
  function toCount(value, min) {
    var n = Number(value);
    if (!Number.isFinite(n)) return min;
    n = Math.round(n);
    if (n < min) return min;
    return n;
  }

  // Coerce a model count into 1..MODELS. Junk input — including zero and
  // negatives, which no real selection can produce — means all models: the
  // safe failure is charging for everything, never silently undercharging.
  function toModelCount(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return MODELS;
    n = Math.round(n);
    if (n < 1) return MODELS;
    if (n > MODELS) return MODELS;
    return n;
  }

  function runsPerMonth(frequencyId) {
    for (var i = 0; i < FREQUENCIES.length; i++) {
      if (FREQUENCIES[i].id === frequencyId) return FREQUENCIES[i].runsPerMonth;
    }
    return runsPerMonth(DEFAULT_FREQUENCY);
  }

  function frequencyLabel(frequencyId) {
    for (var i = 0; i < FREQUENCIES.length; i++) {
      if (FREQUENCIES[i].id === frequencyId) return FREQUENCIES[i].label;
    }
    return frequencyLabel(DEFAULT_FREQUENCY);
  }

  // The fewest prompts that still clears the $29 floor at this frequency,
  // model count and brand count. Deliberately rounded DOWN: that lands the
  // raw price just under $29 so the floor is what sets it, and every
  // cheapest plan reads exactly $29 rather than $30-something.
  //
  // Every prompt is checked for EVERY brand, so brands multiply the data a
  // prompt yields and the minimum falls as brands rise — the inverse of
  // frequency and models, where less means MORE prompts to reach the floor.
  //   1 brand, 5 models: daily -> 11, 2-day -> 23, 3-day -> 34, weekly -> 87
  //   25 brands, 5 models, weekly -> 3;  1 brand, 1 model, daily -> 58
  // Never below 1: past that point (e.g. 25 brands daily) a single prompt
  // already exceeds the bundle and the price sits honestly above the floor.
  function minPromptsFor(frequencyId, modelCount, brands) {
    var b = toCount(brands, MIN_BRANDS);
    var perMonthPerPrompt = b * toModelCount(modelCount) * runsPerMonth(frequencyId);
    return Math.max(1, Math.floor(MIN_DATA_POINTS / perMonthPerPrompt));
  }

  // Changing tracking frequency or toggling a model must not move the price.
  // Someone picking "weekly", or dropping Perplexity, is choosing how the
  // same budget gets spent, not asking to pay less, so the prompt count
  // absorbs the change instead of the price. Paying less is what the sliders
  // are for.
  //
  // Price depends only on total data points, so holding data points steady
  // holds the price steady, and the new prompt count is just:
  //     prompts = dataPoints / (brands x models x runs)
  //
  // Rounded DOWN for the same reason minPromptsFor is: it can only ever land
  // at or below the previous price, never above it, and the cheapest config
  // still reads exactly MIN_PRICE instead of a dollar over.
  //   1 brand, 40 prompts daily (6,000 dp) -> 300 weekly / 120 3-day / 80 2-day
  //   Same 6,000 dp on fewer models       -> 50 on 4 / 100 on 2 / 200 on 1
  //
  // toModels is optional: omitted means the model count is not changing,
  // which is what every frequency-only caller wants.
  function promptsHoldingDataPoints(brands, prompts, fromFrequencyId, toFrequencyId, fromModels, toModels) {
    var mcFrom = toModelCount(fromModels);
    var mcTo = (toModels === undefined || toModels === null) ? mcFrom : toModelCount(toModels);
    var b = toCount(brands, MIN_BRANDS);
    var p = toCount(prompts, minPromptsFor(fromFrequencyId, mcFrom, b));

    var target = b * p * mcFrom * runsPerMonth(fromFrequencyId);
    return promptsForDataPoints(target, b, toFrequencyId, mcTo);
  }

  // Re-express a REMEMBERED data point budget at any configuration. The UI
  // stores the volume the customer chose with the sliders and calls this on
  // every model/frequency toggle. Deriving each toggle from the stored budget
  // instead of the previous toggle's rounded result means chained toggles
  // never accumulate drift, and every toggle path round trips exactly.
  function promptsForDataPoints(targetDataPoints, brands, frequencyId, modelCount) {
    var mc = toModelCount(modelCount);
    var b = toCount(brands, MIN_BRANDS);
    var floorPrompts = minPromptsFor(frequencyId, mc, b);

    var target = Number(targetDataPoints);
    var perPrompt = b * mc * runsPerMonth(frequencyId);
    if (!Number.isFinite(target) || target <= 0 || perPrompt <= 0) return floorPrompts;

    var next = Math.floor(target / perPrompt);

    // The slider has ends. Past them the price does move, which is honest:
    // there is no prompt count that buys the same volume at this frequency
    // and model count.
    if (next < floorPrompts) return floorPrompts;
    if (next > MAX_PROMPTS) return MAX_PROMPTS;
    return next;
  }

  /* ---------------------------- THE MATH -------------------------------- */

  // One "data point" is one prompt, checked on one tracked AI model, on one
  // run. This is the same formula behind the numbers on the current pricing
  // page, with the model count now a chosen input instead of a constant 5.
  function dataPoints(brands, prompts, frequencyId, modelCount) {
    var mc = toModelCount(modelCount);
    var b = toCount(brands, MIN_BRANDS);
    var p = toCount(prompts, minPromptsFor(frequencyId, mc, b));
    return b * p * mc * runsPerMonth(frequencyId);
  }

  // Split a volume across the graduated brackets. Returns one row per bracket
  // the volume actually reaches, so the UI can show the breakdown line by line.
  function bracketRows(totalDataPoints) {
    var dp = Number(totalDataPoints);
    if (!Number.isFinite(dp) || dp <= 0) return [];

    var rows = [];
    var lowerBound = 0;

    for (var i = 0; i < BRACKETS.length; i++) {
      var bracket = BRACKETS[i];
      if (dp <= lowerBound) break;

      var upperBound = Math.min(dp, bracket.upTo);
      var units = upperBound - lowerBound;

      rows.push({
        from: lowerBound,
        to: upperBound,
        units: units,
        ratePer1k: bracket.ratePer1k,
        subtotal: (units / 1000) * bracket.ratePer1k,
        isLast: bracket.upTo === Infinity
      });

      lowerBound = bracket.upTo;
    }

    return rows;
  }

  // Unrounded monthly cost for a raw volume.
  function rawPrice(totalDataPoints) {
    var rows = bracketRows(totalDataPoints);
    var total = 0;
    for (var i = 0; i < rows.length; i++) {
      total += rows[i].subtotal;
    }
    return total;
  }

  // The one function the UI calls. Everything shown on screen comes from here.
  function price(brands, prompts, frequencyId, billing, modelCount) {
    var mc = toModelCount(modelCount);
    var b = toCount(brands, MIN_BRANDS);
    var p = toCount(prompts, minPromptsFor(frequencyId, mc, b));
    var dp = dataPoints(b, p, frequencyId, mc);

    var rows = bracketRows(dp);

    // The floor. Bracket maths sets the price unless it lands under $29.
    var metered = Math.round(rawPrice(dp));
    var monthly = Math.max(MIN_PRICE, metered);
    var atFloor = monthly > metered;

    var isYearly = billing === 'yearly';
    var perMonth = isYearly
      ? Math.round(monthly * (1 - ANNUAL_DISCOUNT))
      : monthly;
    var billedNow = isYearly ? perMonth * 12 : monthly;
    var yearlySaving = isYearly ? monthly * 12 - billedNow : 0;

    return {
      brands: b,
      prompts: p,
      frequencyId: frequencyId,
      frequencyLabel: frequencyLabel(frequencyId),
      runsPerMonth: runsPerMonth(frequencyId),
      modelCount: mc,
      dataPoints: dp,
      rows: rows,
      metered: metered,
      atFloor: atFloor,
      minPrompts: minPromptsFor(frequencyId, mc, b),
      monthly: monthly,
      perMonth: perMonth,
      billedNow: billedNow,
      isYearly: isYearly,
      yearlySaving: yearlySaving,
      effectiveRatePer1k: dp > 0 ? monthly / (dp / 1000) : 0,
      perBrand: b > 0 ? Math.round(perMonth / b) : 0,
      overMaxBrands: b > MAX_BRANDS,
      bookMeeting: monthly >= BOOK_MEETING_FROM,
      premiumIncluded: monthly >= PREMIUM_FEATURES_FROM
    };
  }

  // Exposed so the bracket tests can check subtotals against the unrounded sum.
  price.raw = rawPrice;

  return {
    MODELS: MODELS,
    MODEL_NAMES: MODEL_NAMES,
    FREQUENCIES: FREQUENCIES,
    DEFAULT_FREQUENCY: DEFAULT_FREQUENCY,
    BRACKETS: BRACKETS,
    ANNUAL_DISCOUNT: ANNUAL_DISCOUNT,
    PREMIUM_FEATURES_FROM: PREMIUM_FEATURES_FROM,
    BOOK_MEETING_FROM: BOOK_MEETING_FROM,
    MIN_PRICE: MIN_PRICE,
    MIN_DATA_POINTS: MIN_DATA_POINTS,
    MIN_BRANDS: MIN_BRANDS,
    MAX_BRANDS: MAX_BRANDS,
    MAX_PROMPTS: MAX_PROMPTS,
    PROMPT_STEP: PROMPT_STEP,
    toCount: toCount,
    toModelCount: toModelCount,
    runsPerMonth: runsPerMonth,
    frequencyLabel: frequencyLabel,
    minPromptsFor: minPromptsFor,
    promptsHoldingDataPoints: promptsHoldingDataPoints,
    promptsForDataPoints: promptsForDataPoints,
    dataPoints: dataPoints,
    bracketRows: bracketRows,
    rawPrice: rawPrice,
    price: price
  };
});
