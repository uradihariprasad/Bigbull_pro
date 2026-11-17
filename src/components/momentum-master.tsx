"use client";

/**
 * MOMENTUM MASTER — Section A/B/C UI.
 * NIFTY and SENSEX are always rendered independently, never excluded by the
 * Top-10 rankings or filters.
 */
import { useMemo, useState } from "react";
import { useApi, useApp, apiUrl, istTime, fmt, fmtPct, fmtInt, clsColor, type J } from "@/lib/client";
import { Panel, Badge, Loading, NoData, isUnavailable, ClassChip, EvidenceBars } from "@/components/ui";
import { CandleChart, overlaysFromLevels, type SROverlay } from "@/components/charts";
import { ChevronDown } from "lucide-react";

const FILTERS = [
  "ALL", "BULLISH", "BEARISH", "STRONG_MOMENTUM", "ACCELERATING", "WEAKENING",
  "HIGH_CONFIDENCE", "FUTURES_CONFIRMED", "OPTIONS_CONFIRMED",
  "BREAKOUT_CANDIDATES", "RETEST_CANDIDATES", "REVERSAL_CANDIDATES",
] as const;

function MomentumRow({ r, onPick }: { r: J; onPick: (s: string) => void }) {
  return (
    <tr className="pg-row-hover cursor-pointer" onClick={() => onPick(r.symbol)}>
      <td className="pg-td tnum text-grey">#{r.rank}</td>
      <td className="pg-td">
        <span className="font-bold text-txt">{r.symbol}</span>
        <span className="ml-1 text-[9px] text-grey">{r.name?.slice(0, 18)}</span>
      </td>
      <td className="pg-td tnum">{fmt(r.price)}</td>
      <td className={`pg-td tnum ${clsColor(r.chgPct)}`}>{fmtPct(r.chgPct)}</td>
      <td className="pg-td"><Badge tone={r.direction === "BULLISH" ? "green" : "red"}>{r.direction}</Badge></td>
      <td className="pg-td tnum font-bold text-blue">{r.strength}</td>
      <td className="pg-td text-[9.5px]">{r.acceleration}</td>
      <td className="pg-td">
        <span className="text-green tnum">{r.buyerDominance}</span>
        <span className="text-grey"> / </span>
        <span className="text-red tnum">{r.sellerDominance}</span>
      </td>
      <td className="pg-td text-[9px] text-txt-dim">{r.futuresPositioning}</td>
      <td className="pg-td tnum">{r.rvol?.toFixed(1) ?? "—"}</td>
      <td className={`pg-td tnum ${clsColor(r.fmpi)}`}>{r.fmpi?.toFixed(0) ?? "—"}</td>
      <td className={`pg-td tnum ${clsColor(r.rsNifty)}`}>{r.rsNifty == null ? "—" : `${r.rsNifty > 0 ? "+" : ""}${r.rsNifty}`}</td>
      <td className="pg-td max-w-[150px] truncate text-[9.5px] text-txt-dim" title={r.scenario}>{r.scenario}</td>
      <td className="pg-td tnum">{r.nextTarget == null ? "—" : fmt(r.nextTarget)}</td>
      <td className="pg-td"><Badge tone={r.confidence === "HIGH_CONFIDENCE" ? "green" : r.confidence === "INSUFFICIENT_DATA" ? "red" : "amber"}>{r.confidence.replace("_CONFIDENCE", "").replace("_", " ")}</Badge></td>
    </tr>
  );
}

function RankTable({ rows, onPick }: { rows: J[]; onPick: (s: string) => void }) {
  if (!rows.length)
    return (
      <div className="py-6 text-center text-[11px] text-grey">
        No valid candidates right now. Entries are never fabricated to fill ten slots.
      </div>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr>{["#", "Stock", "LTP", "Chg %", "Dir", "Str", "Accel", "Buy/Sell", "Futures", "RVOL", "FMPI", "RS", "Scenario", "Target", "Conf"].map((h) => <th key={h} className="pg-th">{h}</th>)}</tr>
        </thead>
        <tbody>{rows.map((r) => <MomentumRow key={r.symbol} r={r} onPick={onPick} />)}</tbody>
      </table>
    </div>
  );
}

function IndexCard({ symbol, onPick }: { symbol: string; onPick: (s: string) => void }) {
  const { data, loading } = useApi<J>(apiUrl("/api/momentum-master/index", { symbol }), 5000);
  if (loading && !data) return <Panel title={`${symbol} — Index Intelligence`}><Loading label={`Computing ${symbol} momentum`} /></Panel>;
  if (!data || isUnavailable(data))
    return <Panel title={`${symbol} — Index Intelligence`}><NoData reason={isUnavailable(data) ? data.reason : "Loading"} code={isUnavailable(data) ? data.code : "LOADING"} /></Panel>;

  const m = data.momentum ?? {};
  const sr = data.sr ?? {};
  const prim = data.scenario?.find((s: J) => s.primary) ?? data.scenario?.[0];
  const tz = prim?.targetZones?.[0];
  const rt = prim?.retestZone;
  const rv = prim?.reversalZone;
  return (
    <Panel
      title={`${symbol} — ${data.name}`}
      right={<Badge tone={data.freshness === "LIVE" ? "green" : "amber"}>{data.freshness}</Badge>}
      className="cursor-pointer hover:border-blue/40"
    >
      <div onClick={() => onPick(symbol)}>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="tnum text-xl font-bold">{fmt(data.price)}</span>
          <span className={`tnum text-[12px] font-semibold ${clsColor(data.chgPct)}`}>{fmtPct(data.chgPct)} ({fmt(data.chgAbs)})</span>
          <Badge tone={m.direction === "BULLISH" ? "green" : m.direction === "BEARISH" ? "red" : "grey"}>{m.direction}</Badge>
          <span className="text-[10px] text-txt-dim">strength <b className="tnum text-txt">{m.strength}</b> · {m.acceleration}</span>
          <EvidenceBars coverage={m.coverage} />
        </div>

        <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10px] sm:grid-cols-4">
          {[
            ["Buyers", `${data.buyerDominance?.score ?? "—"}`, "text-green"],
            ["Sellers", `${data.sellerDominance?.score ?? "—"}`, "text-red"],
            ["Futures", data.futures?.classification?.replaceAll("_", " ") ?? "UNAVAILABLE", "text-txt-dim"],
            ["FMPI", data.fmpi ? `${data.fmpi.value} / ${data.fmpi.smoothed ?? "—"}` : "—", "text-blue"],
            ["Structure", data.structure ?? "—", "text-txt"],
            ["Confidence", m.confidence?.replace("_CONFIDENCE", "") ?? "—", "text-amber"],
          ].map(([l, v, c]) => (
            <div key={l as string} className="rounded bg-panel2 p-1.5">
              <div className="text-[8.5px] uppercase tracking-wider text-grey">{l}</div>
              <div className={`tnum font-semibold ${c}`}>{v}</div>
            </div>
          ))}
        </div>

        <div className="mt-2 grid grid-cols-2 gap-1 text-[10px] sm:grid-cols-4">
          {[
            ["IMM SUP", sr.immediateSupport, "text-green"],
            ["PRI SUP", sr.primarySupport, "text-green"],
            ["IMM RES", sr.immediateResistance, "text-red"],
            ["PRI RES", sr.primaryResistance, "text-red"],
          ].map(([l, v, c]) => (
            <div key={l as string}>
              <span className="text-grey">{l}</span>{" "}
              <span className={`tnum font-semibold ${c}`}>{v == null ? "N/A" : fmt(v as number)}</span>
            </div>
          ))}
        </div>

        {prim && (
          <div className="mt-2 rounded border border-border bg-panel2 p-2 text-[10px]">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={prim.direction === "BULLISH" ? "green" : prim.direction === "BEARISH" ? "red" : "grey"}>{prim.label}</Badge>
              <Badge tone={prim.confidence === "HIGH_CONFIDENCE" ? "green" : prim.confidence === "INSUFFICIENT_DATA" ? "red" : "amber"}>{prim.confidence.replace("_CONFIDENCE", "").replace("_", " ")}</Badge>
            </div>
            {tz && (
              <div className="mt-1 text-txt-dim">
                Next target zone <b className="tnum text-txt">{fmt(tz.lower)}–{fmt(tz.upper)}</b> <span className="text-grey">({tz.source})</span>
              </div>
            )}
            {rt && <div className="text-txt-dim">Retest zone <b className="tnum text-txt">{fmt(rt.lower)}–{fmt(rt.upper)}</b> · {String(prim.retestStatus).replaceAll("_", " ")}</div>}
            {rv && <div className="text-txt-dim">Reversal zone <b className="tnum text-txt">{fmt(rv.lower)}–{fmt(rv.upper)}</b> · {String(prim.reversalStatus).replaceAll("_", " ")}</div>}
            {prim.invalidationPrice != null && (
              <div className="mt-1 text-amber">Invalidation: {prim.invalidation} @ <b className="tnum">{fmt(prim.invalidationPrice)}</b></div>
            )}
            {!!prim.conflicting?.length && <div className="mt-1 text-grey">Conflicting: {prim.conflicting.slice(0, 2).join(" · ")}</div>}
          </div>
        )}
        <div className="mt-1 text-[9px] text-grey">updated {istTime(data.updatedAt)} · click for deep analysis</div>
      </div>
    </Panel>
  );
}

function Workspace({ symbol }: { symbol: string }) {
  const { data: ws, loading } = useApi<J>(apiUrl("/api/momentum-master/workspace", { symbol }), 4000);
  const { data: cd } = useApi<J>(apiUrl("/api/candles", { symbol, tf: "5m", days: 7 }), 10000);
  const { data: lv } = useApi<J>(apiUrl("/api/intel/sr-levels", { symbol, tf: "5m" }), 6000);
  const [tab, setTab] = useState<"SCENARIO" | "BUYER_SELLER" | "CHAIN" | "FUTURES">("SCENARIO");
  const overlays: SROverlay[] = useMemo(() => overlaysFromLevels(lv && !isUnavailable(lv) ? lv.levels : null), [lv]);

  if (loading && !ws) return <Panel title={`${symbol} — Deep Analysis`}><Loading label="Building scenario intelligence" /></Panel>;
  if (!ws || isUnavailable(ws))
    return <Panel title={`${symbol} — Deep Analysis`}><NoData reason={isUnavailable(ws) ? ws.reason : "Loading"} code={isUnavailable(ws) ? ws.code : "LOADING"} /></Panel>;

  const m = ws.momentum ?? {};
  const oi = ws.optionsChain && !isUnavailable(ws.optionsChain) ? ws.optionsChain : null;
  const fut = ws.futures && !isUnavailable(ws.futures) ? ws.futures : null;

  return (
    <Panel
      title={`${symbol} — Deep Analysis`}
      sub={`${ws.name} · momentum ${m.strength} ${m.direction} · ${m.acceleration} · confidence ${m.confidence?.replace("_CONFIDENCE", "").replace("_", " ")}`}
      right={<Badge tone={ws.freshness === "LIVE" ? "green" : "amber"}>{ws.freshness}</Badge>}
    >
      <CandleChart data={cd} height={300} overlays={overlays} fmpi={ws.fmpi?.smoothedHistory?.map((h: J) => ({ ts: h.ts, value: h.smoothed })) ?? null} />

      <div className="mt-2 flex flex-wrap gap-1">
        {(["SCENARIO", "BUYER_SELLER", "CHAIN", "FUTURES"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${tab === t ? "border-blue/50 bg-blue/10 text-blue" : "border-border bg-panel2 text-txt-dim"}`}>
            {t.replaceAll("_", " ")}
          </button>
        ))}
      </div>

      <div className="mt-2">
        {tab === "SCENARIO" && (
          <div className="space-y-2">
            {(ws.scenario ?? []).map((s: J, i: number) => (
              <div key={i} className="rounded border border-border bg-panel2 p-2 text-[10.5px]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={s.direction === "BULLISH" ? "green" : s.direction === "BEARISH" ? "red" : "grey"}>{s.label}</Badge>
                  {s.primary && <Badge tone="blue">PRIMARY</Badge>}
                  <Badge tone={s.confidence === "HIGH_CONFIDENCE" ? "green" : s.confidence === "INSUFFICIENT_DATA" ? "red" : "amber"}>{s.confidence.replace("_CONFIDENCE", "").replace("_", " ")}</Badge>
                  <span className="text-grey">coverage {Math.round((s.coverage ?? 0) * 100)}%</span>
                </div>
                {!!s.targetZones?.length && (
                  <div className="mt-1">
                    {s.targetZones.map((t: J, k: number) => (
                      <div key={k} className="text-txt-dim">
                        Target {k + 1}: <b className="tnum text-txt">{fmt(t.lower)}–{fmt(t.upper)}</b> <span className="text-grey">({t.source})</span>
                      </div>
                    ))}
                  </div>
                )}
                {s.retestZone && <div className="text-txt-dim">Retest: <b className="tnum text-txt">{fmt(s.retestZone.lower)}–{fmt(s.retestZone.upper)}</b> · {String(s.retestStatus).replaceAll("_", " ")}</div>}
                {s.reversalZone && <div className="text-txt-dim">Reversal: <b className="tnum text-txt">{fmt(s.reversalZone.lower)}–{fmt(s.reversalZone.upper)}</b> · {String(s.reversalStatus).replaceAll("_", " ")}</div>}
                <div className="mt-1 grid gap-1 md:grid-cols-2">
                  <div><span className="text-green">Supporting:</span> {(s.supporting ?? []).slice(0, 3).join(" · ") || "—"}</div>
                  <div><span className="text-red">Conflicting:</span> {(s.conflicting ?? []).slice(0, 3).join(" · ") || "—"}</div>
                </div>
                {s.invalidationPrice != null && <div className="mt-1 text-amber">Invalidation @ <b className="tnum">{fmt(s.invalidationPrice)}</b> — {s.invalidation}</div>}
                {!!s.confirmation?.length && <div className="text-grey">Confirmation: {s.confirmation.join(" · ")}</div>}
              </div>
            ))}
          </div>
        )}

        {tab === "BUYER_SELLER" && (
          <div className="grid gap-2 md:grid-cols-2">
            {[
              { t: "BUYER DOMINANCE", d: ws.buyerDominance, tone: "green" as const },
              { t: "SELLER DOMINANCE", d: ws.sellerDominance, tone: "red" as const },
            ].map(({ t, d, tone }) => (
              <div key={t} className="rounded border border-border bg-panel2 p-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-txt-dim">{t}</span>
                  <span className={`tnum text-[14px] font-bold ${tone === "green" ? "text-green" : "text-red"}`}>{d.score}</span>
                </div>
                <div className="mt-1 text-[9.5px] text-grey">trend: {d.trend}</div>
                {(d.evidence ?? []).map((e: string, i: number) => <div key={i} className="mt-0.5 text-[9.5px] text-txt-dim">• {e}</div>)}
                {!!d.levels?.length && <div className="mt-1 text-[9.5px] text-txt">levels: {d.levels.map((x: number) => fmt(x)).join(" · ")}</div>}
              </div>
            ))}
          </div>
        )}

        {tab === "CHAIN" && (
          <div className="overflow-x-auto">
            {oi ? (
              <table className="w-full">
                <thead><tr>{["Strike", "CE OI", "5m CE ΔOI", "15m CE ΔOI", "Sess CE ΔOI", "PE OI", "5m PE ΔOI", "15m PE ΔOI", "Sess PE ΔOI"].map((h) => <th key={h} className="pg-th">{h}</th>)}</tr></thead>
                <tbody>
                  {(oi.rows ?? []).filter((r: J) => r.isAtm || Math.abs((r.strike ?? 0) - (oi.atm ?? 0)) <= (oi.atm ?? 0) * 0.012).slice(0, 7).map((r: J) => (
                    <tr key={r.strike} className={r.isAtm ? "bg-blue/[0.07]" : ""}>
                      <td className={`pg-td font-bold ${r.isAtm ? "text-blue" : ""}`}>{fmt(r.strike, r.strike >= 1000 ? 0 : 1)}</td>
                      <td className="pg-td text-blue">{fmtInt(r.ce?.current)}</td>
                      <td className="pg-td">{r.ce?.chg5m == null ? <span className="text-grey">N/A</span> : <span className={clsColor(r.ce.chg5m)}>{fmtInt(r.ce.chg5m)}</span>}</td>
                      <td className="pg-td">{r.ce?.chg15m == null ? <span className="text-grey">N/A</span> : <span className={clsColor(r.ce.chg15m)}>{fmtInt(r.ce.chg15m)}</span>}</td>
                      <td className="pg-td">{r.ce?.sess == null ? <span className="text-grey">N/A</span> : <span className={clsColor(r.ce.sess)}>{fmtInt(r.ce.sess)}</span>}</td>
                      <td className="pg-td text-amber">{fmtInt(r.pe?.current)}</td>
                      <td className="pg-td">{r.pe?.chg5m == null ? <span className="text-grey">N/A</span> : <span className={clsColor(r.pe.chg5m)}>{fmtInt(r.pe.chg5m)}</span>}</td>
                      <td className="pg-td">{r.pe?.chg15m == null ? <span className="text-grey">N/A</span> : <span className={clsColor(r.pe.chg15m)}>{fmtInt(r.pe.chg15m)}</span>}</td>
                      <td className="pg-td">{r.pe?.sess == null ? <span className="text-grey">N/A</span> : <span className={clsColor(r.pe.sess)}>{fmtInt(r.pe.sess)}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <NoData compact reason={ws.optionsChain?.reason ?? "Option chain unavailable"} code={ws.optionsChain?.code} />
            )}
            <div className="mt-1 text-[9px] text-grey">ΔOI windows are time-based rolling references. OI changes are positioning evidence only — they do not prove writing or dominance.</div>
          </div>
        )}

        {tab === "FUTURES" && (
          <div>
            {fut ? (
              <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
                {[
                  ["Fut LTP", fmt(fut.fut?.ltp)], ["Fut chg", fmtPct(fut.fut?.chgPct)],
                  ["Fut OI", fmtInt(fut.fut?.oi)], ["5m ΔOI", fut.fut?.oiChg5m == null ? "N/A" : fmtInt(fut.fut.oiChg5m)],
                  ["15m ΔOI", fut.fut?.oiChg15m == null ? "N/A" : fmtInt(fut.fut.oiChg15m)],
                  ["Session ΔOI", fut.fut?.oiSessChg == null ? "N/A" : fmtInt(fut.fut.oiSessChg)],
                  ["Basis", fmt(fut.basis)], ["Classification", fut.fut?.classification?.replaceAll("_", " ") ?? "—"],
                ].map(([l, v]) => (
                  <div key={l as string} className="rounded bg-panel2 p-2">
                    <div className="text-[8.5px] uppercase text-grey">{l}</div>
                    <div className="tnum font-semibold">{v}</div>
                  </div>
                ))}
                <div className="col-span-2 text-[10px] text-txt-dim sm:col-span-4">{fut.confirmation}</div>
              </div>
            ) : (
              <NoData compact reason={ws.futures?.reason ?? "Futures unavailable"} code={ws.futures?.code} />
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

export function MomentumMaster() {
  const { data: rank, loading } = useApi<J>("/api/momentum-master/ranking", 8000);
  const { openWorkspace } = useApp();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const applyFilter = (rows: J[]): J[] => {
    let r = rows;
    if (q) r = r.filter((x) => x.symbol.includes(q.toUpperCase()));
    switch (filter) {
      case "STRONG_MOMENTUM": return r.filter((x) => x.strength >= 45);
      case "ACCELERATING": return r.filter((x) => x.acceleration === "ACCELERATING");
      case "WEAKENING": return r.filter((x) => x.acceleration === "DECELERATING");
      case "HIGH_CONFIDENCE": return r.filter((x) => x.confidence === "HIGH_CONFIDENCE");
      case "FUTURES_CONFIRMED": return r.filter((x) => /BUILDUP|COVERING|UNWINDING/i.test(x.futuresPositioning ?? ""));
      case "OPTIONS_CONFIRMED": return r.filter((x) => x.optionsPositioning && x.optionsPositioning !== "UNAVAILABLE");
      case "BREAKOUT_CANDIDATES": return r.filter((x) => /breakout/i.test(x.scenario ?? ""));
      case "RETEST_CANDIDATES": return r.filter((x) => /retest/i.test(x.scenario ?? ""));
      case "REVERSAL_CANDIDATES": return r.filter((x) => /reversal/i.test(x.scenario ?? ""));
      default: return r;
    }
  };

  const comp = rank && !isUnavailable(rank) ? rank.comparison : null;

  return (
    <div className="space-y-2.5">
      <Panel pad>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[13px] font-bold tracking-tight">
            MOMENTUM <span className="text-blue">MASTER</span>
          </span>
          <span className="text-[10px] text-txt-dim">Momentum · Buyer/Seller · Target · Retest · Reversal intelligence</span>
          {rank && !isUnavailable(rank) && (
            <span className="ml-auto text-[9.5px] text-grey">
              {rank.universeScanned} instruments scanned · {rank.actualBullish} bullish / {rank.actualBearish} bearish valid · updated {istTime(rank.generatedAt)}
            </span>
          )}
        </div>
      </Panel>

      {/* SECTION A — indices, always present */}
      <div className="grid gap-2.5 lg:grid-cols-2">
        <IndexCard symbol="NIFTY" onPick={setSelected} />
        <IndexCard symbol="SENSEX" onPick={setSelected} />
      </div>

      {/* index comparison */}
      {comp && (
        <Panel title="Index comparison — NIFTY vs SENSEX" sub={comp.note}>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {[
              ["NIFTY strength", comp.nifty.strength, clsColor(comp.nifty.direction === "BULLISH" ? 1 : -1)],
              ["SENSEX strength", comp.sensex.strength, clsColor(comp.sensex.direction === "BULLISH" ? 1 : -1)],
              ["Relative", `${comp.relativeMomentum > 0 ? "+" : ""}${comp.relativeMomentum}`, clsColor(comp.relativeMomentum)],
              ["Agreement", comp.agreement, comp.agreement === "AGREE" ? "text-green" : "text-amber"],
              ["NIFTY accel", comp.nifty.acceleration, "text-txt"],
            ].map(([l, v, c]) => (
              <div key={l as string} className="rounded bg-panel2 p-2">
                <div className="text-[8.5px] uppercase tracking-wider text-grey">{l}</div>
                <div className={`tnum text-[13px] font-bold ${c}`}>{v}</div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* SECTION B — top 10 */}
      {loading && !rank ? (
        <Panel title="Top 10 F&O momentum"><Loading label="Scanning the F&O universe" /></Panel>
      ) : !rank || isUnavailable(rank) ? (
        <Panel title="Top 10 F&O momentum"><NoData reason={isUnavailable(rank) ? rank.reason : "Loading"} code={isUnavailable(rank) ? rank.code : "LOADING"} /></Panel>
      ) : (
        <div className="grid gap-2.5 xl:grid-cols-2">
          <Panel title={<span className="text-green">Top 10 Bullish F&O Stocks</span>} sub={`${rank.actualBullish} valid bullish candidate(s)`} pad={false}>
            <RankTable rows={applyFilter(rank.bullish ?? []).map((r: J, i: number) => ({ ...r, rank: i + 1 }))} onPick={setSelected} />
          </Panel>
          <Panel title={<span className="text-red">Top 10 Bearish F&O Stocks</span>} sub={`${rank.actualBearish} valid bearish candidate(s)`} pad={false}>
            <RankTable rows={applyFilter(rank.bearish ?? []).map((r: J, i: number) => ({ ...r, rank: i + 1 }))} onPick={setSelected} />
          </Panel>
        </div>
      )}

      {/* filters */}
      <Panel pad={false} title="Filters">
        <div className="flex flex-wrap gap-1 p-2">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded border px-2 py-0.5 text-[9.5px] font-semibold ${filter === f ? "border-blue/50 bg-blue/10 text-blue" : "border-border bg-panel2 text-txt-dim"}`}>
              {f.replaceAll("_", " ")}
            </button>
          ))}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search symbol…" className="ml-auto h-6 w-36 rounded border border-border bg-panel2 px-2 text-[10.5px] outline-none focus:border-blue/50" />
        </div>
      </Panel>

      {/* SECTION C — deep analysis */}
      {selected ? (
        <Workspace symbol={selected} />
      ) : (
        <Panel title="Instrument deep analysis">
          <div className="py-4 text-center text-[11px] text-grey">Click any stock above — or an index card — to open its scenario, buyer/seller, option-chain and futures intelligence.</div>
        </Panel>
      )}
    </div>
  );
}
