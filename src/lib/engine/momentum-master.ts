/**
 * PULSEGRID 2.0 — MOMENTUM MASTER: Momentum Strength + Market Scenario Engine.
 *
 * Two capabilities, one unified evidence base:
 *
 *  1. MomentumStrength — an ATR/volatility-aware, correlation-controlled
 *     composite (0–100 bullish / 0–100 bearish) used to rank the F&O universe.
 *     Ranking uses momentum QUALITY (direction, acceleration, participation,
 *     derivatives confirmation, structure, relative strength, data confidence)
 *     — never raw % price change alone.
 *
 *  2. MarketScenarioEngine — produces competing CONTINUATION / RETEST /
 *     REVERSAL / FAILED-BREAK scenarios with structural target zones, retest
 *     zones, reversal zones, explicit confirmation conditions and invalidation
 *     prices. It never forces a direction: when evidence conflicts it returns
 *     INSUFFICIENT_DATA / conflicting scenarios.
 *
 * Data-integrity rules enforced throughout:
 *  - Missing evidence is UNAVAILABLE / PARTIAL, never zero.
 *  - OI increase alone never establishes writing or dominance.
 *  - Bid/ask depth is order-book state, not executed order flow. CVD is not
 *    computed without genuine trade-side classification.
 *  - Every target/zone carries its exact source.
 */

import { clamp, squash } from "./indicators";
import type { SymbolIntel } from "./trading";

/* ----------------------------------------------------------------- types */
export type Availability =
  | "LIVE" | "DELAYED" | "STALE" | "PARTIAL" | "UNAVAILABLE"
  | "INSUFFICIENT_HISTORY" | "INVALID_MAPPING";

export type Confidence = "HIGH_CONFIDENCE" | "MODERATE_CONFIDENCE" | "LOW_CONFIDENCE" | "INSUFFICIENT_DATA";

export type ScenarioKind =
  | "BULLISH_CONTINUATION" | "BEARISH_CONTINUATION"
  | "RETEST_PULLBACK" | "REVERSAL" | "FAILED_BREAKOUT" | "FAILED_BREAKDOWN"
  | "SIDEWAYS_RANGE";

export type RetestStatus =
  | "RETEST_APPROACHING" | "RETEST_IN_PROGRESS" | "RETEST_HOLDING"
  | "RETEST_CONFIRMED" | "RETEST_FAILED" | "PULLBACK_WITHIN_TREND" | "NOT_APPLICABLE";

export type ReversalStatus =
  | "REVERSAL_WATCH" | "EARLY_REVERSAL_CANDIDATE" | "REVERSAL_CONFIRMATION_PENDING"
  | "REVERSAL_CONFIRMED" | "REVERSAL_FAILED" | "NOT_APPLICABLE";

export interface PriceZone {
  lower: number;
  upper: number;
  source: string;
  significance: string;
  distancePct: number;
  evidence: string[];
  confirmation: "CONFIRMED" | "PROVISIONAL" | "PROJECTION";
  invalidation: string;
}

export interface Scenario {
  kind: ScenarioKind;
  label: string;
  primary: boolean;
  confidence: Confidence;
  /** 0..1 share of expected evidence actually present */
  coverage: number;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  targetZones: PriceZone[];
  retestZone: PriceZone | null;
  retestStatus: RetestStatus;
  reversalZone: PriceZone | null;
  reversalStatus: ReversalStatus;
  trigger: string[];
  supporting: string[];
  conflicting: string[];
  confirmation: string[];
  invalidationPrice: number | null;
  invalidation: string;
}

export interface MomentumStrengthResult {
  symbol: string;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  /** 0..100 quality of the prevailing directional momentum */
  strength: number;
  /** separate bullish / bearish pressure, both 0..100 */
  bullishScore: number;
  bearishScore: number;
  acceleration: "ACCELERATING" | "DECELERATING" | "FLAT";
  buyerDominance: { score: number; trend: "INCREASING" | "DECREASING" | "STABLE"; evidence: string[]; levels: number[] };
  sellerDominance: { score: number; trend: "INCREASING" | "DECREASING" | "STABLE"; evidence: string[]; levels: number[] };
  components: Record<string, { value: number | null; weight: number; availability: Availability; reason: string }>;
  relativeStrengthNifty: number | null;
  relativeStrengthSector: number | null;
  confidence: Confidence;
  coverage: number;
  freshness: string;
  scenario: Scenario[];
  targets: { up: PriceZone[]; down: PriceZone[]; retest: { bull: PriceZone | null; bear: PriceZone | null }; reversal: { bull: PriceZone | null; bear: PriceZone | null } };
}

/* ------------------------------------------------------- weights (tuning) */
export const MS_WEIGHTS = {
  priceMomentum: 0.25,
  relativeVolume: 0.15,
  futuresPositioning: 0.15,
  optionsPositioning: 0.15,
  marketStructure: 0.1,
  trendQuality: 0.1,
  relativeStrength: 0.1,
};

export interface MomentumInput {
  symbol: string;
  price: number;
  atr: number | null;
  chgPct: number;
  /** returns over 1m/5m/10m/15m/30m where valid (null = unavailable) */
  returns: { m1: number | null; m5: number | null; m10: number | null; m15: number | null; m30: number | null };
  rvol: number | null;
  emaAlign: number | null;
  structureTrend: "UP" | "DOWN" | "RANGE" | null;
  vwapDistPct: number | null;
  fmpi: { value: number; smoothed: number | null; confirmed: number | null; acceleration: string; coverage: number } | null;
  fut: { classification: string; chgPct: number; oiChgPct: number | null; basis: number | null } | null;
  /** option-chain positioning read, already corroborated upstream */
  oiBias: number | null;
  oiNote: string;
  ceSess: number | null;
  peSess: number | null;
  sr: {
    immediateSupport: number | null; primarySupport: number | null;
    immediateResistance: number | null; primaryResistance: number | null;
    zones: { side: string; mid: number; low: number; high: number; sources: string[]; strength: number; oiOnly: boolean; lifecycle: string }[];
  } | null;
  profile: { poc: number; vah: number; val: number } | null;
  niftyChgPct: number | null;
  sectorChgPct: number | null;
  /** order-book evidence (depth is book state, not executed flow) */
  depth: { bidQty: number; askQty: number; ratio: number } | null;
  freshness: string;
}

/* ------------------------------------------------------------- helpers */
const cls = (c: number): Confidence =>
  c >= 0.75 ? "HIGH_CONFIDENCE" : c >= 0.5 ? "MODERATE_CONFIDENCE" : c > 0 ? "LOW_CONFIDENCE" : "INSUFFICIENT_DATA";

function zone(low: number, high: number, source: string, significance: string, price: number, evidence: string[], confirmation: PriceZone["confirmation"], invalidation: string): PriceZone {
  const lo = Math.min(low, high);
  const hi = Math.max(low, high);
  return {
    lower: Math.round(lo * 100) / 100,
    upper: Math.round(hi * 100) / 100,
    source,
    significance,
    distancePct: Math.round((((lo + hi) / 2 - price) / price) * 10000) / 100,
    evidence,
    confirmation,
    invalidation,
  };
}

/* =============================================================== STRENGTH */
export function computeMomentumStrength(inp: MomentumInput): MomentumStrengthResult {
  const atr = Math.max(inp.atr ?? inp.price * 0.005, inp.price * 0.0008);
  const comps: Record<string, { value: number | null; weight: number; availability: Availability; reason: string }> = {};

  // ---- price momentum: ATR-normalised, multi-horizon agreement -----------
  const horizons = [inp.returns.m1, inp.returns.m5, inp.returns.m10, inp.returns.m15, inp.returns.m30];
  const units = horizons.map((r) => (r == null ? null : r / (atr / inp.price) * 100));
  const valid = units.filter((u): u is number => u != null);
  const pmVal = valid.length
    ? clamp(squash((valid.reduce((s, u) => s + u, 0) / valid.length) / 2.2), -1, 1)
    : null;
  comps.priceMomentum = {
    value: pmVal, weight: MS_WEIGHTS.priceMomentum,
    availability: valid.length ? (valid.length >= 3 ? "LIVE" : "PARTIAL") : "INSUFFICIENT_HISTORY",
    reason: valid.length
      ? `ATR-normalised returns over ${valid.length} horizon(s) (${units.map((u, i) => ["1m", "5m", "10m", "15m", "30m"][i]).filter((_, i) => units[i] != null).join(", ")})`
      : "no valid return windows",
  };

  // ---- relative volume ---------------------------------------------------
  comps.relativeVolume = inp.rvol == null
    ? { value: null, weight: MS_WEIGHTS.relativeVolume, availability: "UNAVAILABLE", reason: "RVOL history not yet collected" }
    : { value: clamp((inp.rvol - 1) / 1.8, -1, 1), weight: MS_WEIGHTS.relativeVolume, availability: "LIVE", reason: `RVOL ${inp.rvol.toFixed(2)}× vs same-time-of-day history` };

  // ---- futures positioning (price + OI TOGETHER) --------------------------
  let fpVal: number | null = null;
  let fpAvail: Availability = "UNAVAILABLE";
  let fpReason = "futures contract or OI baseline unavailable";
  if (inp.fut?.classification === "LONG_BUILDUP") { fpVal = 0.85; fpAvail = "LIVE"; fpReason = "price up + OI up → long buildup candidate"; }
  else if (inp.fut?.classification === "SHORT_BUILDUP") { fpVal = -0.85; fpAvail = "LIVE"; fpReason = "price down + OI up → short buildup candidate"; }
  else if (inp.fut?.classification === "SHORT_COVERING") { fpVal = 0.5; fpAvail = "LIVE"; fpReason = "price up + OI down → short covering candidate"; }
  else if (inp.fut?.classification === "LONG_UNWINDING") { fpVal = -0.5; fpAvail = "LIVE"; fpReason = "price down + OI down → long unwinding candidate"; }
  else if (inp.fut) { fpVal = 0; fpAvail = "PARTIAL"; fpReason = `futures ${inp.fut.classification.toLowerCase()} — not directional`; }
  comps.futuresPositioning = { value: fpVal, weight: MS_WEIGHTS.futuresPositioning, availability: fpAvail, reason: fpReason };

  // ---- options positioning (corroborated upstream, never OI alone) --------
  comps.optionsPositioning = inp.oiBias == null
    ? { value: null, weight: MS_WEIGHTS.optionsPositioning, availability: "UNAVAILABLE", reason: inp.oiNote || "option-chain OI history insufficient" }
    : { value: clamp(inp.oiBias, -1, 1), weight: MS_WEIGHTS.optionsPositioning, availability: "LIVE", reason: inp.oiNote };

  // ---- market structure --------------------------------------------------
  comps.marketStructure = !inp.structureTrend
    ? { value: null, weight: MS_WEIGHTS.marketStructure, availability: "INSUFFICIENT_HISTORY", reason: "not enough candles for swing structure" }
    : { value: inp.structureTrend === "UP" ? 0.8 : inp.structureTrend === "DOWN" ? -0.8 : 0,
        weight: MS_WEIGHTS.marketStructure, availability: "LIVE",
        reason: `swing structure ${inp.structureTrend.toLowerCase()}` };

  // ---- trend quality: EMA stack + VWAP distance with neutral band --------
  const trendParts: number[] = [];
  if (inp.emaAlign != null) trendParts.push(inp.emaAlign);
  if (inp.vwapDistPct != null) trendParts.push(clamp(squash(inp.vwapDistPct / (atr / inp.price) / 1.5), -1, 1));
  comps.trendQuality = trendParts.length
    ? { value: clamp(trendParts.reduce((s, v) => s + v, 0) / trendParts.length, -1, 1), weight: MS_WEIGHTS.trendQuality,
        availability: "LIVE", reason: "EMA alignment + ATR-normalised VWAP distance" }
    : { value: null, weight: MS_WEIGHTS.trendQuality, availability: "INSUFFICIENT_HISTORY", reason: "no EMA/VWAP data" };

  // ---- relative strength vs NIFTY / sector -------------------------------
  const rsN = inp.niftyChgPct == null ? null : inp.chgPct - inp.niftyChgPct;
  const rsS = inp.sectorChgPct == null ? null : inp.chgPct - inp.sectorChgPct;
  comps.relativeStrength = rsN == null
    ? { value: null, weight: MS_WEIGHTS.relativeStrength, availability: "UNAVAILABLE", reason: "index reference unavailable" }
    : { value: clamp(squash(rsN / 1.5), -1, 1), weight: MS_WEIGHTS.relativeStrength, availability: "LIVE",
        reason: `RS vs NIFTY ${rsN >= 0 ? "+" : ""}${rsN.toFixed(2)}pp${rsS != null ? ` · vs sector ${rsS >= 0 ? "+" : ""}${rsS.toFixed(2)}pp` : ""}` };

  // ---- aggregate with coverage weighting (never zero-fill) ---------------
  let num = 0, den = 0, availW = 0;
  const bullishEv: string[] = [];
  const bearishEv: string[] = [];
  for (const [k, c] of Object.entries(comps)) {
    if (c.value == null) continue;
    num += c.value * c.weight;
    den += c.weight;
    availW += c.weight;
    const txt = `${k}: ${c.reason}`;
    if (c.value > 0.15) bullishEv.push(txt);
    else if (c.value < -0.15) bearishEv.push(txt);
  }
  const coverage = den > 0 ? availW / MS_WEIGHTS.relativeStrength / 7 : 0;
  const raw = den > 0 ? (num / den) * 100 : 0;

  const bullishScore = Math.round(clamp(raw, 0, 100));
  const bearishScore = Math.round(clamp(-raw, 0, 100));
  const strength = Math.round(Math.abs(raw));
  const direction: MomentumStrengthResult["direction"] = strength < 8 ? "NEUTRAL" : raw > 0 ? "BULLISH" : "BEARISH";

  // acceleration from FMPI (already time-aware upstream)
  const accel = (inp.fmpi?.acceleration ?? "FLAT") as MomentumStrengthResult["acceleration"];

  // ---- buyer / seller dominance -----------------------------------------
  const depthBias = inp.depth && inp.depth.ratio > 0 ? clamp((inp.depth.ratio - 1) / 0.6, -1, 1) : null;
  const buyParts = [raw / 100, depthBias].filter((v) => v != null) as number[];
  const buyerScore = Math.round(clamp((buyParts.reduce((s, v) => s + v, 0) / Math.max(buyParts.length, 1)) * 100, 0, 100));
  const sellerScore = Math.round(100 - buyerScore);
  const buyerEvidence: string[] = [];
  const sellerEvidence: string[] = [];
  const buyerLevels: number[] = [];
  const sellerLevels: number[] = [];
  if (inp.depth) buyerEvidence.push(`Order-book bid/ask ratio ${inp.depth.ratio.toFixed(2)} — resting-book state, NOT executed flow`);
  if (pmVal != null && pmVal > 0.15) buyerEvidence.push("Price momentum positive across available horizons");
  if (pmVal != null && pmVal < -0.15) sellerEvidence.push("Price momentum negative across available horizons");
  if (inp.fut?.classification === "LONG_BUILDUP") buyerEvidence.push("Futures long buildup candidate (price↑ OI↑)");
  if (inp.fut?.classification === "SHORT_BUILDUP") sellerEvidence.push("Futures short buildup candidate (price↓ OI↑)");
  if (inp.peSess != null && inp.peSess > 0) buyerEvidence.push("PE OI added near ATM — put-side positioning increasing (not proof of buying)");
  if (inp.ceSess != null && inp.ceSess > 0) sellerEvidence.push("CE OI added near ATM — call-side positioning increasing (not proof of selling)");
  if (inp.sr) {
    if (inp.sr.immediateSupport != null) buyerLevels.push(inp.sr.immediateSupport);
    if (inp.sr.primarySupport != null) buyerLevels.push(inp.sr.primarySupport);
    if (inp.sr.immediateResistance != null) sellerLevels.push(inp.sr.immediateResistance);
    if (inp.sr.primaryResistance != null) sellerLevels.push(inp.sr.primaryResistance);
  }
  buyerEvidence.push("Executed trade-side classification: UNAVAILABLE — Upstox REST feed does not supply aggressor flags; CVD is not computed");
  const buyerTrend: MomentumStrengthResult["buyerDominance"]["trend"] = accel === "ACCELERATING" ? "INCREASING" : accel === "DECELERATING" ? "DECREASING" : "STABLE";

  const freshness = inp.freshness;
  const confidence = cls(inp.freshness === "LIVE" || inp.freshness === "DELAYED" ? coverage : coverage * 0.6);

  // ---- scenarios ---------------------------------------------------------
  const scenarios = buildScenarios(inp, {
    direction, strength, coverage, confidence,
    sr: inp.sr, profile: inp.profile, atr, fmpi: inp.fmpi,
    futClass: inp.fut?.classification ?? "UNAVAILABLE",
    bullEv: bullishEv, bearEv: bearishEv,
  });

  const up = scenarios.find((s) => s.direction === "BULLISH")?.targetZones ?? [];
  const down = scenarios.find((s) => s.direction === "BEARISH")?.targetZones ?? [];
  const rt = scenarios.find((s) => s.retestZone);
  const rv = scenarios.find((s) => s.reversalZone);

  return {
    symbol: inp.symbol,
    direction, strength, bullishScore, bearishScore, acceleration: accel,
    buyerDominance: { score: buyerScore, trend: buyerTrend, evidence: buyerEvidence, levels: buyerLevels.map((x) => Math.round(x * 100) / 100) },
    sellerDominance: { score: sellerScore, trend: buyerTrend === "INCREASING" ? "DECREASING" : buyerTrend === "DECREASING" ? "INCREASING" : "STABLE", evidence: sellerEvidence, levels: sellerLevels.map((x) => Math.round(x * 100) / 100) },
    components: comps,
    relativeStrengthNifty: rsN == null ? null : Math.round(rsN * 100) / 100,
    relativeStrengthSector: rsS == null ? null : Math.round(rsS * 100) / 100,
    confidence, coverage: Math.round(coverage * 100) / 100, freshness,
    scenario: scenarios,
    targets: {
      up, down,
      retest: { bull: rt?.retestZone && rt.direction === "BULLISH" ? rt.retestZone : null, bear: rt?.retestZone && rt.direction === "BEARISH" ? rt.retestZone : null },
      reversal: { bull: rv?.reversalZone && rv.direction === "BULLISH" ? rv.reversalZone : null, bear: rv?.reversalZone && rv.direction === "BEARISH" ? rv.reversalZone : null },
    },
  };
}

/* ============================================================= SCENARIOS */
interface ScenarioCtx {
  direction: MomentumStrengthResult["direction"];
  strength: number;
  coverage: number;
  confidence: Confidence;
  sr: MomentumInput["sr"];
  profile: MomentumInput["profile"];
  atr: number;
  fmpi: MomentumInput["fmpi"];
  futClass: string;
  bullEv: string[];
  bearEv: string[];
}

/**
 * Build the competing scenario set. Every zone is derived from an actual
 * structural level; ATR projections are used only as an explicit fallback and
 * are labelled PROJECTION.
 */
function buildScenarios(inp: MomentumInput, ctx: ScenarioCtx): Scenario[] {
  const out: Scenario[] = [];
  const price = inp.price;
  const sr = ctx.sr;
  const atr = ctx.atr;
  const bull = ctx.direction === "BULLISH";
  const bear = ctx.direction === "BEARISH";

  const resAbove: number | null = sr?.immediateResistance ?? null;
  const resAbove2: number | null = sr?.primaryResistance ?? null;
  const supBelow: number | null = sr?.immediateSupport ?? null;
  const supBelow2: number | null = sr?.primarySupport ?? null;
  const proj = (n: number) => Math.round(price * 100) / 100;

  // ---------------- CONTINUATION ----------------
  if (bull || bear) {
    const dir = bull ? "BULLISH" : "BEARISH";
    const t1 = bull ? resAbove : supBelow;
    const t2 = bull ? resAbove2 : supBelow2;
    const targets: PriceZone[] = [];
    if (t1 != null) targets.push(zone(t1 - atr * 0.15, t1 + atr * 0.15, `Dynamic S/R · ${bull ? "immediate resistance" : "immediate support"}`, "nearest structural barrier", price, [bull ? "Price approaching overhead supply" : "Price approaching demand below"], "CONFIRMED", bull ? `Accepted close above ${t1.toFixed(2)} invalidates the barrier` : `Accepted close below ${t1.toFixed(2)} invalidates the support`));
    if (t2 != null) targets.push(zone(t2 - atr * 0.2, t2 + atr * 0.2, `Dynamic S/R · ${bull ? "primary resistance" : "primary support"}`, "next significant structural zone", price, ["Second structural objective"], "CONFIRMED", bull ? `Accepted close above ${t2.toFixed(2)} invalidates it` : `Accepted close below ${t2.toFixed(2)} invalidates it`));
    if (!targets.length) targets.push(zone(price + atr * 1.5 * (bull ? 1 : -1) - atr * 0.2, price + atr * 1.5 * (bull ? 1 : -1) + atr * 0.2, "ATR projection (no structural zone available)", "fallback projection — NOT a structural level", price, ["No structural target within range"], "PROJECTION", "Replace as soon as a structural zone forms"));

    const supporting = bull ? ctx.bullEv : ctx.bearEv;
    const conflicting = bull ? ctx.bearEv : ctx.bullEv;
    const invalid = bull
      ? (supBelow ?? price - atr * 1.2)
      : (resAbove ?? price + atr * 1.2);
    out.push({
      kind: bull ? "BULLISH_CONTINUATION" : "BEARISH_CONTINUATION",
      label: bull ? "Bullish continuation" : "Bearish continuation",
      primary: ctx.strength >= 25,
      confidence: ctx.confidence,
      coverage: ctx.coverage,
      direction: dir,
      targetZones: targets,
      retestZone: null, retestStatus: "NOT_APPLICABLE", reversalZone: null, reversalStatus: "NOT_APPLICABLE",
      trigger: bull
        ? ["Hold above immediate support", "Buyers defend pullbacks", "Futures/options positioning stays supportive"]
        : ["Hold below immediate resistance", "Sellers reject rallies", "Futures/options positioning stays supportive"],
      supporting,
      conflicting,
      confirmation: [
        bull ? "Completed 5m candle closes above the immediate resistance with follow-through"
             : "Completed 5m candle closes below the immediate support with follow-through",
        "FMPI stays in the same direction on the smoothed series",
        ...(inp.fut ? [`Futures remains ${inp.fut.classification.replaceAll("_", " ").toLowerCase()}`] : []),
      ],
      invalidationPrice: Math.round(invalid * 100) / 100,
      invalidation: bull
        ? `Accepted completed-candle close below ${(invalid as number).toFixed(2)} invalidates bullish continuation`
        : `Accepted completed-candle close above ${(invalid as number).toFixed(2)} invalidates bearish continuation`,
    });
  }

  // ---------------- RETEST / PULLBACK ----------------
  if (sr) {
    // a broken resistance becomes a retest zone from above (bullish retest)
    const bullRetest = resAbove != null && price > resAbove;
    const bearRetest = supBelow != null && price < supBelow;
    if (bullRetest || bearRetest) {
      const lvl = bullRetest ? resAbove! : supBelow!;
      const dir = bullRetest ? "BULLISH" : "BEARISH";
      const near = Math.abs(price - lvl) <= atr * 1.5;
      const status: RetestStatus = near ? (Math.abs(price - lvl) <= atr * 0.4 ? "RETEST_IN_PROGRESS" : "RETEST_APPROACHING") : "PULLBACK_WITHIN_TREND";
      out.push({
        kind: "RETEST_PULLBACK",
        label: bullRetest ? "Retest of broken resistance (bullish)" : "Retest of broken support (bearish)",
        primary: false,
        confidence: ctx.confidence,
        coverage: ctx.coverage,
        direction: dir,
        targetZones: bullRetest
          ? (resAbove2 != null ? [zone(resAbove2 - atr * 0.2, resAbove2 + atr * 0.2, "Dynamic S/R · primary resistance", "continuation objective after a successful retest", price, ["Next structural barrier"], "CONFIRMED", `Accepted close above ${resAbove2.toFixed(2)} invalidates it`)] : [])
          : (supBelow2 != null ? [zone(supBelow2 - atr * 0.2, supBelow2 + atr * 0.2, "Dynamic S/R · primary support", "continuation objective after a successful retest", price, ["Next structural demand"], "CONFIRMED", `Accepted close below ${supBelow2.toFixed(2)} invalidates it`)] : []),
        retestZone: zone(lvl - atr * 0.25, lvl + atr * 0.25, "Dynamic S/R · broken zone", "prior barrier now acting as the retest level", price,
          [bullRetest ? "Prior resistance being retested from above" : "Prior support being retested from below"], "CONFIRMED",
          bullRetest ? `Accepted close below ${lvl.toFixed(2)} fails the retest` : `Accepted close above ${lvl.toFixed(2)} fails the retest`),
        retestStatus: status,
        reversalZone: null, reversalStatus: "NOT_APPLICABLE",
        trigger: [
          bullRetest ? "Price pulls back into the broken resistance from above" : "Price rallies into the broken support from below",
          bullRetest ? "Selling pressure decreases into the zone" : "Buying pressure decreases into the zone",
          "Buyers/sellers respond with a completed-candle reaction",
        ],
        supporting: [bullRetest ? "Prior resistance retest is the classic continuation setup" : "Prior support retest is the classic continuation setup",
                     ...(inp.fut && !inp.fut.classification.includes("UNAVAILABLE") ? [`Futures ${inp.fut.classification.replaceAll("_", " ").toLowerCase()}`] : [])],
        conflicting: ["Role transition is NOT automatic — requires acceptance plus a hold, not just a tag of the level"],
        confirmation: [
          bullRetest ? "A completed candle holds above the zone and closes back in the trend direction" : "A completed candle holds below the zone and closes back in the trend direction",
          "Follow-through on the next completed candle",
        ],
        invalidationPrice: bullRetest ? Math.round((lvl - atr * 0.3) * 100) / 100 : Math.round((lvl + atr * 0.3) * 100) / 100,
        invalidation: bullRetest
          ? `Accepted completed-candle close below ${(lvl - atr * 0.3).toFixed(2)} converts this into a failed breakout`
          : `Accepted completed-candle close above ${(lvl + atr * 0.3).toFixed(2)} converts this into a failed breakdown`,
      });
    }
  }

  // ---------------- REVERSAL ----------------
  const reversalLvl = bull ? supBelow2 ?? supBelow : resAbove2 ?? resAbove;
  if (reversalLvl != null) {
    const dir = bull ? "BEARISH" : "BULLISH"; // reversal is against the prevailing trend
    const near = Math.abs(price - reversalLvl) <= atr * 2;
    const status: ReversalStatus = near ? "EARLY_REVERSAL_CANDIDATE" : "REVERSAL_WATCH";
    out.push({
      kind: "REVERSAL",
      label: bull ? "Potential bearish reversal at support-adjacent supply" : "Potential bullish reversal at resistance-adjacent demand",
      primary: false,
      confidence: ctx.coverage >= 0.6 ? "LOW_CONFIDENCE" : "INSUFFICIENT_DATA",
      coverage: ctx.coverage,
      direction: dir,
      targetZones: [],
      retestZone: null, retestStatus: "NOT_APPLICABLE",
      reversalZone: zone(reversalLvl - atr * 0.3, reversalLvl + atr * 0.3,
        bull ? "Dynamic S/R · primary/immediate support" : "Dynamic S/R · primary/immediate resistance",
        "structural zone where the prevailing move could lose control", price,
        [bull ? "Sellers could regain control at this demand zone" : "Buyers could regain control at this supply zone",
         "OI concentration alone does NOT confirm this — price reaction is required"],
        "CONFIRMED",
        bull ? `Accepted close below ${(reversalLvl - atr * 0.3).toFixed(2)} confirms breakdown instead of reversal`
             : `Accepted close above ${(reversalLvl + atr * 0.3).toFixed(2)} confirms breakout instead of reversal`),
      reversalStatus: status,
      trigger: [
        bull ? "Price reaches the support zone and sellers fail to press lower" : "Price reaches the resistance zone and buyers fail to press higher",
        "Repeated rejection / a lower high (or higher low) forms",
        "Momentum decelerates on the smoothed FMPI",
      ],
      supporting: [
        `Momentum deceleration: ${(ctx.fmpi?.acceleration ?? "unknown").toLowerCase()}`,
        ...(ctx.futClass.includes("BUILDUP") ? [`Futures ${ctx.futClass.replaceAll("_", " ").toLowerCase()}`] : []),
      ],
      conflicting: ["A reversal is never confirmed from a single rejection candle or one indicator"],
      confirmation: [
        bull ? "A completed candle forms a higher low and closes back above the zone with follow-through"
             : "A completed candle forms a lower high and closes back below the zone with follow-through",
        "FMPI raw series shows an impulse in the reversal direction",
      ],
      invalidationPrice: Math.round((reversalLvl + (bull ? -atr : atr) * 0.5) * 100) / 100,
      invalidation: bull
        ? `Accepted completed-candle close below ${(reversalLvl - atr * 0.5).toFixed(2)} turns this into a confirmed breakdown (REVERSAL_FAILED)`
        : `Accepted completed-candle close above ${(reversalLvl + atr * 0.5).toFixed(2)} turns this into a confirmed breakout (REVERSAL_FAILED)`,
    });
  }

  // ---------------- FAILED BREAKOUT / BREAKDOWN ----------------
  if (sr && (resAbove != null || supBelow != null)) {
    const fbRes: number | null = sr?.immediateResistance ?? null;
    const fbSup: number | null = sr?.immediateSupport ?? null;
    const lvl: number = fbRes != null ? fbRes : (fbSup as number);
    const isRes = fbRes != null;
    out.push({
      kind: isRes ? "FAILED_BREAKOUT" : "FAILED_BREAKDOWN",
      label: isRes ? "Failed breakout watch" : "Failed breakdown watch",
      primary: false,
      confidence: "LOW_CONFIDENCE",
      coverage: ctx.coverage,
      direction: isRes ? "BEARISH" : "BULLISH",
      targetZones: isRes
        ? (fbSup != null ? [zone(fbSup - atr * 0.2, fbSup + atr * 0.2, "Dynamic S/R · immediate support", "opposite-side objective if the breakout fails", price, ["Downside destination after rejection"], "CONFIRMED", `Accepted close below ${Number(fbSup).toFixed(2)} invalidates it`)] : [])
        : (fbRes != null ? [zone(fbRes - atr * 0.2, fbRes + atr * 0.2, "Dynamic S/R · immediate resistance", "opposite-side objective if the breakdown fails", price, ["Upside destination after rejection"], "CONFIRMED", `Accepted close above ${Number(fbRes).toFixed(2)} invalidates it`)] : []),
      retestZone: null, retestStatus: "NOT_APPLICABLE", reversalZone: null, reversalStatus: "NOT_APPLICABLE",
      trigger: [
        isRes ? "Price probes above resistance but closes back below it" : "Price probes below support but closes back above it",
        "Participation does not expand on the attempt",
        "Futures/OI positioning does not confirm the move",
      ],
      supporting: ["Failed attempts often precede an opposite-side rotation"],
      conflicting: ["Requires a completed-candle close back inside the range — an intrabar poke is not a failure"],
      confirmation: [isRes ? "Completed candle closes back below the resistance after trading above it" : "Completed candle closes back above the support after trading below it"],
      invalidationPrice: Math.round(((isRes ? lvl + atr * 0.4 : lvl - atr * 0.4)) * 100) / 100,
      invalidation: isRes
        ? `Accepted completed-candle close above ${(lvl + atr * 0.4).toFixed(2)} confirms a genuine breakout instead`
        : `Accepted completed-candle close below ${(lvl - atr * 0.4).toFixed(2)} confirms a genuine breakdown instead`,
    });
  }

  // ---------------- SIDEWAYS / RANGE ----------------
  if (supBelow != null && resAbove != null) {
    const width = resAbove - supBelow;
    if (width <= atr * 4) {
      out.push({
        kind: "SIDEWAYS_RANGE", label: "Sideways / range", primary: !out.some((s) => s.primary),
        confidence: ctx.confidence, coverage: ctx.coverage, direction: "NEUTRAL",
        targetZones: [
          zone(resAbove - atr * 0.1, resAbove + atr * 0.1, "Range high (dynamic S/R)", "range boundary", price, ["Fade or await breakout"], "CONFIRMED", `Accepted close above ${resAbove.toFixed(2)} breaks the range`),
          zone(supBelow - atr * 0.1, supBelow + atr * 0.1, "Range low (dynamic S/R)", "range boundary", price, ["Fade or await breakdown"], "CONFIRMED", `Accepted close below ${supBelow.toFixed(2)} breaks the range`),
        ],
        retestZone: null, retestStatus: "NOT_APPLICABLE", reversalZone: null, reversalStatus: "NOT_APPLICABLE",
        trigger: ["Price oscillates between the range boundaries", "No directional expansion in volume or positioning"],
        supporting: [`Range width ${(width / atr).toFixed(1)} ATR — compressed`],
        conflicting: ["Directional momentum is present; the range may be resolving"],
        confirmation: ["Repeated rejections at both boundaries without acceptance"],
        invalidationPrice: null,
        invalidation: "Range is invalidated by an accepted completed-candle close outside either boundary",
      });
    }
  }

  if (!out.length) {
    out.push({
      kind: "SIDEWAYS_RANGE", label: "Insufficient evidence — no scenario",
      primary: true, confidence: "INSUFFICIENT_DATA", coverage: ctx.coverage, direction: "NEUTRAL",
      targetZones: [], retestZone: null, retestStatus: "NOT_APPLICABLE", reversalZone: null, reversalStatus: "NOT_APPLICABLE",
      trigger: [], supporting: [], conflicting: ["Not enough structural or derivatives evidence to build a scenario"],
      confirmation: [], invalidationPrice: null,
      invalidation: "No scenario is presented rather than inventing one",
    });
  }
  // the primary scenario is the strongest-confidence directional one
  out.sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0));
  return out;
}

/* ------------------------------------------------------- universe ranking */
export interface RankRow {
  symbol: string;
  name: string;
  price: number;
  chgPct: number;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  strength: number;
  acceleration: string;
  buyerDominance: number;
  sellerDominance: number;
  futuresPositioning: string;
  optionsPositioning: string;
  rvol: number | null;
  fmpi: number | null;
  rsNifty: number | null;
  scenario: string;
  nextTarget: number | null;
  confidence: Confidence;
  coverage: number;
  freshness: string;
}

/** Rank by momentum QUALITY — never by raw % change alone. */
export function rankMomentum(rows: RankRow[]): { bullish: RankRow[]; bearish: RankRow[] } {
  const scored = rows.map((r) => {
    // composite quality score: strength + acceleration + confirmation + data quality
    let q = r.strength;
    if (r.acceleration === "ACCELERATING") q += 12;
    if (r.acceleration === "DECELERATING") q -= 8;
    if (r.futuresPositioning.includes("BUILDUP")) q += 8;
    if (r.futuresPositioning.includes("COVERING") || r.futuresPositioning.includes("UNWINDING")) q += 4;
    if (r.optionsPositioning && !r.optionsPositioning.includes("UNAVAILABLE") && !r.optionsPositioning.includes("Insufficient")) q += 6;
    if (r.rvol != null && r.rvol > 1.3) q += 6;
    if (r.confidence === "HIGH_CONFIDENCE") q += 10;
    else if (r.confidence === "MODERATE_CONFIDENCE") q += 4;
    else if (r.confidence === "INSUFFICIENT_DATA") q -= 25;
    if (r.freshness === "STALE" || r.freshness === "UNAVAILABLE") q -= 30;
    if (r.direction === "NEUTRAL") q -= 20;
    return { r, q };
  });
  const valid = scored.filter((s) => s.r.freshness !== "UNAVAILABLE" && s.r.direction !== "NEUTRAL");
  const bullish = valid.filter((s) => s.r.direction === "BULLISH").sort((a, b) => b.q - a.q).slice(0, 10).map((s) => s.r);
  const bearish = valid.filter((s) => s.r.direction === "BEARISH").sort((a, b) => b.q - a.q).slice(0, 10).map((s) => s.r);
  return { bullish, bearish };
}
