// src/report.js
// Called by the Worker entry (src/index.js) for GET /api/report?ticker=TSLA
//
// Pulls quote / fundamentals / historicals from Financial Modeling Prep,
// computes a deterministic 35/35/30 risk score (Valuation / Financial
// Health / Growth), and optionally asks Claude to write the qualitative
// catalysts / risks / verdict copy. Everything gracefully degrades to
// "N/A" or templated text if a field or the AI key is missing, so the
// tool works on the free tier with zero AI key configured.

const FMP_BASE = "https://financialmodelingprep.com/stable";

export async function handleReport(request, env) {
  const url = new URL(request.url);
  const raw = (url.searchParams.get("ticker") || "").trim().toUpperCase();

  if (!raw || !/^[A-Z.\-]{1,10}$/.test(raw)) {
    return json({ error: "Provide a valid ?ticker= (e.g. AAPL, MSFT, TSLA)." }, 400);
  }

  const apiKey = env.FMP_API_KEY;
  if (!apiKey) {
    return json(
      { error: "Server is missing FMP_API_KEY. Set it with: wrangler secret put FMP_API_KEY (see README)." },
      500
    );
  }

  try {
    const results = await Promise.all([
      safeFetch(`${FMP_BASE}/quote?symbol=${raw}&apikey=${apiKey}`, "quote"),
      safeFetch(`${FMP_BASE}/profile?symbol=${raw}&apikey=${apiKey}`, "profile"),
      safeFetch(`${FMP_BASE}/ratios-ttm?symbol=${raw}&apikey=${apiKey}`, "ratios-ttm"),
      safeFetch(`${FMP_BASE}/key-metrics-ttm?symbol=${raw}&apikey=${apiKey}`, "key-metrics-ttm"),
      safeFetch(`${FMP_BASE}/income-statement?symbol=${raw}&period=quarter&limit=6&apikey=${apiKey}`, "income-statement"),
      safeFetch(`${FMP_BASE}/cash-flow-statement?symbol=${raw}&period=quarter&limit=6&apikey=${apiKey}`, "cash-flow-statement"),
      safeFetch(`${FMP_BASE}/balance-sheet-statement?symbol=${raw}&period=quarter&limit=2&apikey=${apiKey}`, "balance-sheet-statement"),
      safeFetch(`${FMP_BASE}/historical-price-eod/full?symbol=${raw}&apikey=${apiKey}`, "historical-price-eod"),
      safeFetch(`${FMP_BASE}/price-target-consensus?symbol=${raw}&apikey=${apiKey}`, "price-target-consensus"),
    ]);
    const [rQuote, rProfile, rRatios, rKeyMetrics, rIncomeQ, rCashflowQ, rBalanceQ, rHistorical, rPriceTarget] = results;
    const quote = rQuote.data,
      profile = rProfile.data,
      ratios = rRatios.data,
      keyMetrics = rKeyMetrics.data,
      incomeQ = rIncomeQ.data,
      cashflowQ = rCashflowQ.data,
      balanceQ = rBalanceQ.data,
      historical = rHistorical.data,
      priceTarget = rPriceTarget.data;

    // Diagnostics: what each FMP call actually returned. Harmless to include
    // always — the frontend ignores unknown fields, and it saves a round of
    // guesswork if a field ever comes back empty again. View it by opening
    // /api/report?ticker=XXX directly in the browser.
    const debug = results.map((r) => ({
      endpoint: r.label,
      status: r.status,
      ok: r.ok,
      empty: r.empty,
      error: r.error,
    }));

    if (!quote || !quote[0]) {
      return json(
        {
          error: `No data found for "${raw}". Either the ticker is wrong, or your FMP_API_KEY doesn't have access to the /quote endpoint on your current plan — check the key in the FMP dashboard and try again.`,
          _debug: debug,
        },
        404
      );
    }

    const q = quote[0];
    const p = (profile && profile[0]) || {};
    const r = (ratios && ratios[0]) || {};
    const km = (keyMetrics && keyMetrics[0]) || {};
    const bal = (balanceQ && balanceQ[0]) || {};
    const pt = (priceTarget && (Array.isArray(priceTarget) ? priceTarget[0] : priceTarget)) || {};

    const incomeSeries = (incomeQ || [])
      .filter((i) => i && i.date)
      .slice()
      .sort((a, b) => new Date(a.date) - new Date(b.date)); // oldest -> newest
    const cashSeries = (cashflowQ || []).filter((c) => c && c.date);
    const fcfByDate = new Map(cashSeries.map((c) => [c.date, c.freeCashFlow]));

    const quarters = incomeSeries.slice(-5).map((i) => ({
      label: quarterLabel(i.date, i.period, i.calendarYear),
      revenue: i.revenue,
      grossMarginPct: pct(i.grossProfitRatio),
      opMarginPct: pct(i.operatingIncomeRatio),
      netIncome: i.netIncome,
      eps: i.eps,
      fcf: fcfByDate.get(i.date) ?? null,
    }));

    // ---- revenue / margin growth (latest quarter vs 4 quarters back) ----
    const latestQ = incomeSeries[incomeSeries.length - 1];
    const yearAgoQ = incomeSeries[incomeSeries.length - 5];
    const revenueGrowthYoY = growthPct(yearAgoQ?.revenue, latestQ?.revenue);
    const grossMarginDeltaPts =
      latestQ && yearAgoQ ? pct(latestQ.grossProfitRatio) - pct(yearAgoQ.grossProfitRatio) : null;
    const epsGrowthYoY = growthPct(yearAgoQ?.eps, latestQ?.eps);
    const latestFcf = fcfByDate.get(latestQ?.date) ?? null;

    // ---- historical price series for the chart ----
    // historical-price-eod/full has returned either a flat array of bars,
    // or {symbol, historical: [...]}, depending on API version — handle both,
    // and sort explicitly by date rather than assuming newest/oldest-first order.
    const histRaw = Array.isArray(historical) ? historical : (historical && historical.historical) || [];
    const hist = histRaw
      .filter((d) => d && d.date && typeof d.close === "number")
      .slice()
      .sort((a, b) => new Date(a.date) - new Date(b.date)); // oldest -> newest
    const prices = hist.map((d) => ({ date: d.date, close: d.close }));

    // ---- valuation inputs ----
    // FMP's stable API renamed several ratios-ttm fields vs. the old v3 API
    // (e.g. peRatioTTM -> priceToEarningsRatioTTM). Try the new name first,
    // fall back to the old name in case FMP reverts/varies by plan.
    const pe = numOr(r.priceToEarningsRatioTTM, r.peRatioTTM, q.pe);
    const peg = numOr(r.priceToEarningsGrowthRatioTTM, r.pegRatioTTM, km.pegRatioTTM);
    const evEbitda = numOr(km.evToEBITDATTM, r.enterpriseValueMultipleTTM);
    const priceToSales = numOr(r.priceToSalesRatioTTM, km.evToSalesTTM);

    // ---- financial health inputs ----
    const currentRatio = numOr(r.currentRatioTTM, km.currentRatioTTM);
    const debtEquity = numOr(r.debtToEquityRatioTTM, r.debtEquityRatioTTM, km.debtToEquityTTM);
    const roe = pctMaybe(numOr(km.returnOnEquityTTM, r.returnOnEquityTTM, km.roeTTM));
    const roic = pctMaybe(numOr(km.returnOnInvestedCapitalTTM, km.roicTTM));
    const cashAndSTI = bal.cashAndShortTermInvestments ?? null;

    // ---- scoring ----
    const valuationSub = {
      pe: riskFromPE(pe),
      peg: riskFromPEG(peg),
      evEbitda: riskFromEvEbitda(evEbitda),
      priceToSales: riskFromPS(priceToSales),
    };
    const financialSub = {
      currentRatio: riskFromCurrentRatio(currentRatio),
      debtEquity: riskFromDebtEquity(debtEquity),
      roe: riskFromROE(roe),
      fcf: riskFromFCF(latestFcf),
    };
    const growthSub = {
      revenueGrowth: riskFromGrowth(revenueGrowthYoY),
      marginTrend: riskFromMarginTrend(grossMarginDeltaPts),
      epsGrowth: riskFromGrowth(epsGrowthYoY),
    };

    const valuationRisk = avg(Object.values(valuationSub));
    const financialRisk = avg(Object.values(financialSub));
    const growthRisk = avg(Object.values(growthSub));
    const composite = Math.round(valuationRisk * 0.35 + financialRisk * 0.35 + growthRisk * 0.3);

    const scoreBreakdown = {
      valuation: { risk: Math.round(valuationRisk), weight: 35, pts: round1(valuationRisk * 0.35) },
      financialHealth: { risk: Math.round(financialRisk), weight: 35, pts: round1(financialRisk * 0.35) },
      growth: { risk: Math.round(growthRisk), weight: 30, pts: round1(growthRisk * 0.3) },
    };

    const signals = {
      valuation: [
        signalCard("Trailing P/E", fmtX(pe), valuationSub.pe, "Price relative to trailing 12-month earnings."),
        signalCard("PEG Ratio", fmtNum(peg), valuationSub.peg, "P/E adjusted for expected earnings growth."),
        signalCard("EV / EBITDA", fmtX(evEbitda), valuationSub.evEbitda, "Enterprise value vs. cash operating earnings."),
        signalCard("Price / Sales", fmtX(priceToSales), valuationSub.priceToSales, "Market cap relative to revenue."),
        signalCard(
          "Analyst Price Target",
          pt.targetConsensus ? `$${round1(pt.targetConsensus)}` : "N/A",
          pt.targetConsensus ? riskFromTarget(pt.targetConsensus, q.price) : 50,
          pt.targetHigh && pt.targetLow
            ? `Range $${round1(pt.targetLow)}–$${round1(pt.targetHigh)}`
            : "Consensus 12-month analyst target."
        ),
        signalCard(
          "52-Wk Position",
          q.yearHigh && q.yearLow ? `${round1(rangePos(q.price, q.yearLow, q.yearHigh))}%` : "N/A",
          q.yearHigh && q.yearLow ? riskFromRangePos(rangePos(q.price, q.yearLow, q.yearHigh)) : 50,
          "Where price sits within its 52-week range."
        ),
      ],
      financialHealth: [
        signalCard(
          "Cash & ST Investments",
          cashAndSTI ? fmtMoney(cashAndSTI) : "N/A",
          cashAndSTI ? (cashAndSTI > 0 ? 15 : 85) : 50,
          "Liquidity cushion on the balance sheet."
        ),
        signalCard("Current Ratio", fmtNum(currentRatio), financialSub.currentRatio, "Current assets vs. current liabilities."),
        signalCard("Debt / Equity", fmtNum(debtEquity), financialSub.debtEquity, "Leverage relative to shareholder equity."),
        signalCard(
          "Free Cash Flow (Qtr)",
          latestFcf != null ? fmtMoney(latestFcf) : "N/A",
          financialSub.fcf,
          "Operating cash flow after capital expenditures."
        ),
        signalCard("Return on Equity", roe != null ? `${round1(roe)}%` : "N/A", financialSub.roe, "Net income generated per dollar of equity."),
        signalCard("Return on Inv. Capital", roic != null ? `${round1(roic)}%` : "N/A", riskFromROE(roic), "Efficiency of capital deployed across the business."),
      ],
      growth: [
        signalCard(
          "Revenue Growth (YoY)",
          revenueGrowthYoY != null ? `${revenueGrowthYoY > 0 ? "+" : ""}${round1(revenueGrowthYoY)}%` : "N/A",
          growthSub.revenueGrowth,
          "Latest quarter vs. the same quarter last year."
        ),
        signalCard(
          "Gross Margin Trend",
          grossMarginDeltaPts != null ? `${grossMarginDeltaPts > 0 ? "+" : ""}${round1(grossMarginDeltaPts)} pts` : "N/A",
          growthSub.marginTrend,
          "Change in gross margin vs. four quarters ago."
        ),
        signalCard(
          "EPS Growth (YoY)",
          epsGrowthYoY != null ? `${epsGrowthYoY > 0 ? "+" : ""}${round1(epsGrowthYoY)}%` : "N/A",
          growthSub.epsGrowth,
          "Diluted EPS vs. the same quarter last year."
        ),
        signalCard(
          "Latest Q Revenue",
          latestQ ? fmtMoney(latestQ.revenue) : "N/A",
          50,
          "Most recently reported quarterly revenue."
        ),
        signalCard(
          "Latest Q Net Income",
          latestQ ? fmtMoney(latestQ.netIncome) : "N/A",
          latestQ && latestQ.netIncome > 0 ? 20 : 80,
          "Bottom-line profit for the most recent quarter."
        ),
        signalCard(
          "Latest Op. Margin",
          latestQ ? `${round1(pct(latestQ.operatingIncomeRatio))}%` : "N/A",
          50,
          "Operating income as a share of revenue."
        ),
      ],
    };

    // ---- qualitative layer (Claude, optional) ----
    const qualitative = await buildQualitative(env, {
      ticker: raw,
      name: p.companyName || raw,
      composite,
      scoreBreakdown,
      revenueGrowthYoY,
      grossMarginDeltaPts,
      pe,
      peg,
      currentRatio,
      debtEquity,
      price: q.price,
      changePct: q.changesPercentage,
    });

    const payload = {
      meta: { generatedAt: new Date().toISOString() },
      _debug: debug,
      identity: {
        ticker: raw,
        name: p.companyName || raw,
        exchange: q.exchange || p.exchangeShortName || "—",
        sector: p.sector || "—",
        industry: p.industry || "—",
        hq: [p.city, p.country].filter(Boolean).join(", ") || "—",
      },
      quote: {
        price: q.price,
        change: q.change,
        changePercent: q.changesPercentage,
        marketCap: q.marketCap,
        sharesOutstanding: q.sharesOutstanding,
        yearHigh: q.yearHigh,
        yearLow: q.yearLow,
        beta: p.beta ?? null,
        avgVolume: q.avgVolume,
        volume: q.volume,
        earningsAnnouncement: q.earningsAnnouncement || null,
      },
      valuationRaw: { pe, peg, evEbitda, priceToSales, priceTarget: pt },
      financialRaw: { currentRatio, debtEquity, roe, roic, cashAndSTI, latestFcf },
      growthRaw: { revenueGrowthYoY, grossMarginDeltaPts, epsGrowthYoY },
      quarters,
      prices,
      score: { composite, breakdown: scoreBreakdown },
      signals,
      qualitative,
    };

    return json(payload, 200, 300);
  } catch (err) {
    return json({ error: `Unexpected error building report: ${err.message}` }, 500);
  }
}

// ---------------------------------------------------------------------
// Qualitative copy (catalysts / risks / verdict) — Claude if configured,
// deterministic template otherwise.
// ---------------------------------------------------------------------
async function buildQualitative(env, ctx) {
  const fallback = templatedQualitative(ctx);
  if (!env.ANTHROPIC_API_KEY) return fallback;

  try {
    const prompt = `You are generating the qualitative section of an automated stock risk report. Respond with ONLY strict JSON, no markdown fences, matching exactly this shape:
{"blurb": "1 sentence company description", "catalysts": ["...", "...", "... (5-7 short bullet points, each under 20 words)"], "risks": ["...", "...", "... (5-7 short bullet points, each under 20 words)"], "verdict": "2-4 sentence bottom-line paragraph, factual and balanced, no investment recommendation, ending on what to watch next"}

Company: ${ctx.name} (${ctx.ticker})
Current price: $${ctx.price}, change today: ${ctx.changePct}%
Composite risk score (0-100, higher = higher risk): ${ctx.composite}
Score breakdown: Valuation risk ${ctx.scoreBreakdown.valuation.risk}/100 (35% weight), Financial Health risk ${ctx.scoreBreakdown.financialHealth.risk}/100 (35% weight), Growth risk ${ctx.scoreBreakdown.growth.risk}/100 (30% weight)
Revenue growth YoY (latest quarter): ${ctx.revenueGrowthYoY}%
Gross margin change vs year ago: ${ctx.grossMarginDeltaPts} pts
Trailing P/E: ${ctx.pe}, PEG: ${ctx.peg}
Current ratio: ${ctx.currentRatio}, Debt/Equity: ${ctx.debtEquity}

Ground every bullet in the numbers above. Do not invent facts not implied by this data. Keep tone neutral and analytical.`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 900,
        temperature: 0.3,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) return fallback;
    const data = await res.json();
    const text = (data.content || []).map((b) => b.text || "").join("").trim();
    const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed.catalysts || !parsed.risks || !parsed.verdict) return fallback;
    return { ...parsed, source: "claude" };
  } catch {
    return fallback;
  }
}

function templatedQualitative(ctx) {
  const catalysts = [];
  const risks = [];
  if (ctx.revenueGrowthYoY != null) {
    (ctx.revenueGrowthYoY >= 0 ? catalysts : risks).push(
      `Revenue ${ctx.revenueGrowthYoY >= 0 ? "grew" : "declined"} ${Math.abs(round1(ctx.revenueGrowthYoY))}% year-over-year last quarter.`
    );
  }
  if (ctx.grossMarginDeltaPts != null) {
    (ctx.grossMarginDeltaPts >= 0 ? catalysts : risks).push(
      `Gross margin ${ctx.grossMarginDeltaPts >= 0 ? "expanded" : "contracted"} ${Math.abs(round1(ctx.grossMarginDeltaPts))} points versus a year ago.`
    );
  }
  if (ctx.pe != null) {
    (ctx.pe > 0 && ctx.pe < 30 ? catalysts : risks).push(
      `Trailing P/E of ${round1(ctx.pe)}x ${ctx.pe > 0 && ctx.pe < 30 ? "sits within a reasonable range" : "runs well above the broad market average"}.`
    );
  }
  if (ctx.currentRatio != null) {
    (ctx.currentRatio >= 1.5 ? catalysts : risks).push(
      `Current ratio of ${round1(ctx.currentRatio)} indicates ${ctx.currentRatio >= 1.5 ? "solid" : "tight"} short-term liquidity.`
    );
  }
  if (ctx.debtEquity != null) {
    (ctx.debtEquity <= 0.6 ? catalysts : risks).push(
      `Debt/Equity of ${round1(ctx.debtEquity)} points to ${ctx.debtEquity <= 0.6 ? "conservative" : "elevated"} balance-sheet leverage.`
    );
  }
  while (catalysts.length < 3) catalysts.push("No additional automated catalyst detected from current fundamentals.");
  while (risks.length < 3) risks.push("No additional automated risk detected from current fundamentals.");

  const verdict = `${ctx.name} carries a composite risk score of ${ctx.composite}/100. Valuation contributes ${ctx.scoreBreakdown.valuation.pts} points, financial health ${ctx.scoreBreakdown.financialHealth.pts} points, and growth ${ctx.scoreBreakdown.growth.pts} points to that total. This is an automated, rule-based read of the current fundamentals — not a recommendation. Review the underlying quarterly trend and the next earnings date before drawing conclusions.`;

  return {
    blurb: `${ctx.name} (${ctx.ticker}) — automated fundamentals summary.`,
    catalysts: catalysts.slice(0, 7),
    risks: risks.slice(0, 7),
    verdict,
    source: "template",
  };
}

// ---------------------------------------------------------------------
// Risk curves — each returns 0 (low risk) to 100 (high risk).
// Tune the constants below to match your own philosophy.
// ---------------------------------------------------------------------
function riskFromPE(pe) {
  if (pe == null || pe <= 0) return 50;
  return clamp(((pe - 15) / 135) * 100, 0, 100);
}
function riskFromPEG(peg) {
  if (peg == null || peg <= 0) return 50;
  return clamp(((peg - 1) / 3) * 100, 0, 100);
}
function riskFromEvEbitda(ev) {
  if (ev == null) return 50;
  return clamp(((ev - 8) / 60) * 100, 0, 100);
}
function riskFromPS(ps) {
  if (ps == null) return 50;
  return clamp(((ps - 1) / 14) * 100, 0, 100);
}
function riskFromTarget(target, price) {
  if (!target || !price) return 50;
  const upside = ((target - price) / price) * 100;
  return clamp(50 - upside * 2, 0, 100);
}
function riskFromRangePos(posPct) {
  // near the 52-week high = a bit more valuation risk; near the low = less
  return clamp(posPct, 0, 100);
}
function riskFromCurrentRatio(cr) {
  if (cr == null) return 50;
  if (cr >= 2) return 5;
  if (cr <= 0.5) return 100;
  return clamp(((2 - cr) / 1.5) * 100, 0, 100);
}
function riskFromDebtEquity(de) {
  if (de == null) return 50;
  return clamp((de / 2) * 100, 0, 100);
}
function riskFromROE(roe) {
  if (roe == null) return 50;
  if (roe >= 15) return 10;
  if (roe <= 0) return 90;
  return clamp(((15 - roe) / 15) * 90, 0, 90);
}
function riskFromFCF(fcf) {
  if (fcf == null) return 50;
  return fcf > 0 ? 15 : 85;
}
function riskFromGrowth(g) {
  if (g == null) return 50;
  if (g >= 20) return 10;
  if (g <= -10) return 95;
  return clamp(((20 - g) / 30) * 85, 0, 95);
}
function riskFromMarginTrend(deltaPts) {
  if (deltaPts == null) return 50;
  if (deltaPts >= 3) return 10;
  if (deltaPts <= -3) return 90;
  return clamp(50 - deltaPts * 13, 0, 100);
}

// ---------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------
function signalCard(label, value, risk, note) {
  const tag = risk < 34 ? "BEAT" : risk < 67 ? "CAUTION" : "MISS";
  const color = risk < 34 ? "green" : risk < 67 ? "amber" : "red";
  return { label, value, tag, color, note };
}
function avg(arr) {
  const vals = arr.filter((v) => typeof v === "number" && !Number.isNaN(v));
  if (!vals.length) return 50;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function numOr(...vals) {
  for (const v of vals) if (typeof v === "number" && !Number.isNaN(v)) return v;
  return null;
}
function pct(ratio) {
  if (ratio == null) return null;
  return ratio * 100;
}
function pctMaybe(v) {
  if (v == null) return null;
  return Math.abs(v) <= 1.5 ? v * 100 : v; // handles APIs returning 0.049 vs 4.9
}
function growthPct(prev, curr) {
  if (prev == null || curr == null || prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}
function rangePos(price, low, high) {
  if (high === low) return 50;
  return ((price - low) / (high - low)) * 100;
}
function round1(v) {
  if (v == null || Number.isNaN(v)) return v;
  return Math.round(v * 10) / 10;
}
function fmtX(v) {
  return v == null ? "N/A" : `${round1(v)}x`;
}
function fmtNum(v) {
  return v == null ? "N/A" : `${round1(v)}`;
}
function fmtMoney(v) {
  if (v == null) return "N/A";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${round1(abs / 1e12)}T`;
  if (abs >= 1e9) return `${sign}$${round1(abs / 1e9)}B`;
  if (abs >= 1e6) return `${sign}$${round1(abs / 1e6)}M`;
  if (abs >= 1e3) return `${sign}$${round1(abs / 1e3)}K`;
  return `${sign}$${round1(abs)}`;
}
function quarterLabel(date, period, calendarYear) {
  if (period && calendarYear) return `${period} ${calendarYear}`;
  if (!date) return "—";
  const d = new Date(date);
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `Q${q} ${d.getUTCFullYear()}`;
}
async function safeFetch(url, label) {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    let data = null;
    let errorNote = null;
    try {
      data = await res.json();
    } catch {
      errorNote = "non-JSON response";
    }
    if (data && data["Error Message"]) errorNote = String(data["Error Message"]).slice(0, 200);
    const isEmpty = data == null || (Array.isArray(data) && data.length === 0);
    return {
      label,
      status: res.status,
      ok: res.ok && !errorNote,
      empty: isEmpty,
      error: !res.ok ? `HTTP ${res.status}` : errorNote,
      data: res.ok && !errorNote ? data : null,
    };
  } catch (err) {
    return { label, status: 0, ok: false, empty: true, error: String(err.message || err), data: null };
  }
}
function json(obj, status = 200, cacheSeconds = 0) {
  const headers = { "content-type": "application/json; charset=utf-8" };
  if (cacheSeconds) headers["cache-control"] = `public, max-age=${cacheSeconds}`;
  return new Response(JSON.stringify(obj), { status, headers });
}
