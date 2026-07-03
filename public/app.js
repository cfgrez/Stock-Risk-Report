// public/app.js — fetches /api/report?ticker=XXX and renders the 2-page report.

const COLORS = { green: "#33d692", red: "#f9576a", amber: "#f4b94c", accent: "#5cc8ff" };
let lastData = null;

const form = document.getElementById("searchForm");
const input = document.getElementById("tickerInput");
const statusArea = document.getElementById("statusArea");
const reportEl = document.getElementById("report");
const hero = document.getElementById("hero");
const toolbar = document.getElementById("toolbar");
const toolbarBrand = document.getElementById("toolbarBrand");

document.getElementById("chips").addEventListener("click", (e) => {
  const t = e.target.closest(".chip");
  if (!t) return;
  input.value = t.dataset.t;
  form.requestSubmit();
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const ticker = input.value.trim().toUpperCase();
  if (!ticker) return;
  location.hash = ticker;
  loadTicker(ticker);
});

document.getElementById("copyBtn").addEventListener("click", copySummary);

window.addEventListener("DOMContentLoaded", () => {
  const t = location.hash.replace("#", "").trim().toUpperCase();
  if (t) {
    input.value = t;
    loadTicker(t);
  }
});

async function loadTicker(ticker) {
  reportEl.innerHTML = "";
  toolbar.style.display = "none";
  hero.style.display = "block";
  setStatus(`<span class="spinner"></span>Fetching fundamentals for ${escapeHtml(ticker)}…`);
  document.getElementById("searchBtn").disabled = true;

  try {
    const res = await fetch(`/api/report?ticker=${encodeURIComponent(ticker)}`);
    const data = await res.json();
    if (!res.ok) {
      setStatus(data.error || "Something went wrong.", true);
      return;
    }
    lastData = data;
    setStatus("");
    hero.style.display = "none";
    toolbar.style.display = "flex";
    toolbarBrand.textContent = `${data.identity.ticker} · Risk Score Report`;
    reportEl.innerHTML = renderPage1(data) + renderPage2(data);
  } catch (err) {
    setStatus(`Network error: ${err.message}`, true);
  } finally {
    document.getElementById("searchBtn").disabled = false;
  }
}

function setStatus(html, isError = false) {
  statusArea.innerHTML = html ? `<div class="status ${isError ? "error" : ""}">${html}</div>` : "";
}

// ======================================================================
// PAGE 1
// ======================================================================
function renderPage1(d) {
  const q = d.quote;
  const changeUp = (q.changePercent || 0) >= 0;
  const rangePos = q.yearHigh && q.yearLow ? clamp(((q.price - q.yearLow) / (q.yearHigh - q.yearLow)) * 100, 0, 100) : 50;
  const bucket = riskBucket(d.score.composite);

  return `
  <div class="page" id="page1">
    <div class="page-label">PAGE 1 / 2 — SCORE &amp; SIGNALS</div>

    <div class="stockbar">
      <div class="idcol">
        <div class="ticker-badge">${escapeHtml(d.identity.ticker)}</div>
        <div>
          <h1>${escapeHtml(d.identity.name)}</h1>
          <div class="sub">${escapeHtml(d.identity.exchange)} · ${escapeHtml(d.identity.sector)}${d.identity.industry && d.identity.industry !== "—" ? " — " + escapeHtml(d.identity.industry) : ""} &nbsp;|&nbsp; <span>${escapeHtml(d.identity.hq)}</span></div>
        </div>
      </div>
      <div class="pricecol">
        <div class="px mono">${fmtPrice(q.price)}</div>
        <div class="chg ${changeUp ? "up" : "down"}">${changeUp ? "▲" : "▼"} ${fmtAbs(q.change)} (${fmtAbs(q.changePercent)}%)</div>
        <div class="asof">As of ${new Date(d.meta.generatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</div>
      </div>
    </div>

    <div class="rangebar block" style="margin-bottom:30px;">
      <div class="lbls"><span>52-Wk Low ${fmtPrice(q.yearLow)}</span><span>52-Wk High ${fmtPrice(q.yearHigh)}</span></div>
      <div class="track"><div class="fill" style="width:100%"></div><div class="dot" style="left:${rangePos.toFixed(1)}%"></div></div>
    </div>

    <div class="top-grid">
      <div class="gauge-card">
        <div class="gtitle">Composite Risk Score</div>
        ${buildGauge(d.score.composite)}
        <div class="gauge-score mono" style="color:${bucket.color}">${d.score.composite}</div>
        <div class="gauge-verdict" style="color:${bucket.color}">${bucket.label}</div>
        <div class="gauge-note">${bucket.note}</div>
        <div class="gauge-zones">
          <span><i class="zdot" style="background:${COLORS.green}"></i>0–33 Low</span>
          <span><i class="zdot" style="background:${COLORS.amber}"></i>34–66 Mod</span>
          <span><i class="zdot" style="background:${COLORS.red}"></i>67–100 High</span>
        </div>
      </div>

      <div class="kpi-strip">
        <div class="kpi"><div class="k-label">Market Cap</div><div class="k-val mono">${fmtMoney(q.marketCap)}</div><div class="k-sub">${q.sharesOutstanding ? fmtShares(q.sharesOutstanding) + " sh. out." : ""}</div></div>
        <div class="kpi"><div class="k-label">Trailing P/E</div><div class="k-val mono">${fmtX(d.valuationRaw.pe)}</div><div class="k-sub ${riskClass(riskWord(d.score.breakdown.valuation.risk))}">${riskWord(d.score.breakdown.valuation.risk)} valuation</div></div>
        <div class="kpi"><div class="k-label">PEG Ratio</div><div class="k-val mono">${fmtNum(d.valuationRaw.peg)}</div><div class="k-sub">EV/EBITDA ${fmtX(d.valuationRaw.evEbitda)}</div></div>
        <div class="kpi"><div class="k-label">Beta</div><div class="k-val mono">${fmtNum(q.beta)}</div><div class="k-sub">${q.beta && q.beta > 1.3 ? "High volatility" : q.beta ? "Near-market volatility" : "—"}</div></div>
        <div class="kpi"><div class="k-label">Analyst Target</div><div class="k-val mono">${d.valuationRaw.priceTarget && d.valuationRaw.priceTarget.targetConsensus ? "$" + round1(d.valuationRaw.priceTarget.targetConsensus) : "N/A"}</div><div class="k-sub">${d.valuationRaw.priceTarget && d.valuationRaw.priceTarget.targetHigh ? "Range $" + round1(d.valuationRaw.priceTarget.targetLow) + "–$" + round1(d.valuationRaw.priceTarget.targetHigh) : "—"}</div></div>
        <div class="kpi"><div class="k-label">Next Earnings</div><div class="k-val mono" style="font-size:15px;">${q.earningsAnnouncement ? new Date(q.earningsAnnouncement).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "N/A"}</div><div class="k-sub">Auto-refreshed on each visit</div></div>
      </div>
    </div>

    <div class="block">
      <div class="section-title">12-Month Price Action</div>
      <div class="chart-card">
        <div class="chart-head">
          <h3>${escapeHtml(d.identity.ticker)} · Trailing ~12 Months</h3>
          <div class="legend"><span><i class="ldot" style="background:${COLORS.accent}"></i>Close price</span></div>
        </div>
        ${buildChart(d.prices)}
      </div>
    </div>

    <div class="block">
      <div class="section-title">Score Breakdown</div>
      <div class="breakdown">
        ${breakdownRow("Valuation", d.score.breakdown.valuation)}
        ${breakdownRow("Financial Health", d.score.breakdown.financialHealth)}
        ${breakdownRow("Growth", d.score.breakdown.growth)}
      </div>
    </div>

    <div class="block">
      <div class="section-title">Valuation Signals</div>
      <div class="grid6">${d.signals.valuation.map(signalCard).join("")}</div>
    </div>

    <div class="block">
      <div class="section-title">Financial Health Signals</div>
      <div class="grid6">${d.signals.financialHealth.map(signalCard).join("")}</div>
    </div>

    <div class="block">
      <div class="section-title">Growth Signals</div>
      <div class="grid6">${d.signals.growth.map(signalCard).join("")}</div>
    </div>

    <div class="foot">
      <span>${escapeHtml(d.identity.ticker)} Risk Score Report · Automated analysis, not investment advice ${d.qualitative.source === "claude" ? '<span class="ai-badge">AI-assisted copy</span>' : ""}</span>
      <span>Source: Financial Modeling Prep · Generated ${new Date(d.meta.generatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>
    </div>
  </div>`;
}

function breakdownRow(name, b) {
  const color = b.risk < 34 ? COLORS.green : b.risk < 67 ? COLORS.amber : COLORS.red;
  return `
    <div class="bd-row">
      <div class="bd-label"><span class="name">${name}</span><span class="weight">WEIGHT ${b.weight}%</span></div>
      <div class="bd-track"><div class="bd-fill mono" style="width:${b.risk}%;background:${color};"></div></div>
      <div class="bd-right"><b>${b.risk}</b>/100 risk · ${b.pts} pts</div>
    </div>`;
}

function signalCard(s) {
  return `
    <div class="signal ${s.color}">
      <div class="s-top"><div class="s-name">${escapeHtml(s.label)}</div><span class="tag">${s.tag}</span></div>
      <div class="s-val mono">${escapeHtml(String(s.value))}</div>
      <div class="s-note">${escapeHtml(s.note)}</div>
    </div>`;
}

// ---------------- gauge ----------------
function buildGauge(score) {
  const angle = 180 - clamp(score, 0, 100) * 1.8;
  const rad = (angle * Math.PI) / 180;
  const nx = (150 + 100 * Math.cos(rad)).toFixed(1);
  const ny = (150 - 100 * Math.sin(rad)).toFixed(1);
  return `
  <svg viewBox="0 0 300 175" width="100%" style="max-width:260px;">
    <path d="M30,150 A120,120 0 0,1 90,46.1" fill="none" stroke="${COLORS.green}" stroke-width="22" stroke-linecap="round"/>
    <path d="M90,46.1 A120,120 0 0,1 210,46.1" fill="none" stroke="${COLORS.amber}" stroke-width="22" stroke-linecap="round"/>
    <path d="M210,46.1 A120,120 0 0,1 270,150" fill="none" stroke="${COLORS.red}" stroke-width="22" stroke-linecap="round"/>
    <line x1="150" y1="150" x2="${nx}" y2="${ny}" stroke="#eef0f4" stroke-width="3.5" stroke-linecap="round"/>
    <circle cx="150" cy="150" r="8" fill="#eef0f4"/>
    <circle cx="150" cy="150" r="3" fill="#0d0f15"/>
    <text x="30" y="168" fill="#5b6273" font-size="10">0</text>
    <text x="146" y="24" fill="#5b6273" font-size="10">50</text>
    <text x="258" y="168" fill="#5b6273" font-size="10">100</text>
  </svg>`;
}

// ---------------- chart ----------------
function buildChart(prices) {
  if (!prices || prices.length < 2) {
    return `<div style="color:var(--text-faint);font-family:'JetBrains Mono',monospace;font-size:12px;padding:24px 4px;">No price history available for this ticker.</div>`;
  }
  const n = prices.length;
  const closes = prices.map((p) => p.close);
  const rawMin = Math.min(...closes);
  const rawMax = Math.max(...closes);
  const pad = (rawMax - rawMin) * 0.08 || rawMax * 0.05;
  const minP = rawMin - pad;
  const maxP = rawMax + pad;
  const xPad = 44, xRight = 980, yTop = 24, yBottom = 250;
  const xOf = (idx) => xPad + (idx / (n - 1)) * (xRight - xPad);
  const yOf = (price) => yBottom - ((price - minP) / (maxP - minP)) * (yBottom - yTop);

  const pts = downsample(prices, 140);
  const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(p.idx).toFixed(1)},${yOf(p.close).toFixed(1)}`).join(" ");
  const lastPt = pts[pts.length - 1];
  const areaD = `${pathD} L${xOf(lastPt.idx).toFixed(1)},${yBottom} L${xOf(0).toFixed(1)},${yBottom} Z`;

  let lowIdx = 0, highIdx = 0;
  closes.forEach((c, i) => {
    if (c < closes[lowIdx]) lowIdx = i;
    if (c > closes[highIdx]) highIdx = i;
  });
  const lastIdx = n - 1;

  const markers = [
    { idx: lowIdx, price: closes[lowIdx], date: prices[lowIdx].date, title: "52-Wk Low", color: COLORS.red },
    { idx: highIdx, price: closes[highIdx], date: prices[highIdx].date, title: "52-Wk High", color: COLORS.green },
    { idx: lastIdx, price: closes[lastIdx], date: prices[lastIdx].date, title: "Latest", color: COLORS.accent },
  ].sort((a, b) => a.idx - b.idx);

  const markerSvg = markers
    .map((m) => {
      const x = xOf(m.idx), y = yOf(m.price);
      const below = y < 130;
      const ty1 = below ? y + 20 : y - 24;
      const ty2 = below ? y + 31 : y - 13;
      const anchor = x < 150 ? "start" : x > 850 ? "end" : "middle";
      const tx = anchor === "start" ? Math.max(x, 60) : anchor === "end" ? Math.min(x, 960) : x;
      return `
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${m.title === "Latest" ? 5 : 4.5}" fill="${m.color}" stroke="#08090d" stroke-width="1.5"/>
        <text x="${tx.toFixed(1)}" y="${ty1.toFixed(1)}" fill="${m.color}" font-size="9.5" text-anchor="${anchor}">${m.title}</text>
        <text x="${tx.toFixed(1)}" y="${ty2.toFixed(1)}" fill="#5b6273" font-size="9.5" text-anchor="${anchor}">${fmtPrice(m.price)} · ${shortDate(m.date)}</text>`;
    })
    .join("");

  const midP = (minP + maxP) / 2;
  const xLabels = [0, Math.round((n - 1) * 0.25), Math.round((n - 1) * 0.5), Math.round((n - 1) * 0.75), n - 1]
    .map((idx) => `<text x="${xOf(idx).toFixed(1)}" y="272" text-anchor="middle" fill="#5b6273" font-size="10.5">${shortDate(prices[idx].date)}</text>`)
    .join("");

  return `
  <svg viewBox="0 0 1000 300" width="100%" style="display:block;">
    <defs>
      <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${COLORS.accent}" stop-opacity="0.30"/>
        <stop offset="100%" stop-color="${COLORS.accent}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <g stroke="#191c25" stroke-width="1">
      <line x1="40" y1="${yOf(maxP - pad).toFixed(1)}" x2="980" y2="${yOf(maxP - pad).toFixed(1)}"/>
      <line x1="40" y1="${yOf(midP).toFixed(1)}" x2="980" y2="${yOf(midP).toFixed(1)}"/>
      <line x1="40" y1="250" x2="980" y2="250"/>
    </g>
    <g fill="#5b6273" font-size="10">
      <text x="4" y="${(yOf(maxP - pad) + 4).toFixed(1)}">${fmtPrice(maxP - pad)}</text>
      <text x="4" y="${(yOf(midP) + 4).toFixed(1)}">${fmtPrice(midP)}</text>
      <text x="4" y="254">${fmtPrice(minP + pad)}</text>
    </g>
    <path d="${areaD}" fill="url(#areaFill)"/>
    <path d="${pathD}" fill="none" stroke="${COLORS.accent}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${markerSvg}
    ${xLabels}
  </svg>`;
}

function downsample(arr, maxPoints) {
  if (arr.length <= maxPoints) return arr.map((d, i) => ({ ...d, idx: i }));
  const step = arr.length / maxPoints;
  const out = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round(i * step);
    out.push({ ...arr[idx], idx });
  }
  const lastIdx = arr.length - 1;
  if (out[out.length - 1].idx !== lastIdx) out.push({ ...arr[lastIdx], idx: lastIdx });
  return out;
}

// ======================================================================
// PAGE 2
// ======================================================================
function renderPage2(d) {
  const q = d.qualitative;
  const bucket = riskBucket(d.score.composite);
  const markerPos = clamp(100 - d.score.composite, 0, 100);

  return `
  <div class="page" id="page2">
    <div class="page-label">PAGE 2 / 2 — TRENDS &amp; VERDICT</div>

    <div class="block">
      <div class="section-title">Quarterly Trend</div>
      ${buildQuarterlyTable(d.quarters)}
    </div>

    <div class="block">
      <div class="section-title">Latest Financials &amp; Upcoming Earnings</div>
      ${buildEarningsPanel(d)}
    </div>

    <div class="block">
      <div class="section-title">Catalysts vs. Risks</div>
      <div class="dual-col">
        <div class="col-card cat">
          <h4>↑ Catalysts</h4>
          <ul>${q.catalysts.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>
        </div>
        <div class="col-card risk">
          <h4>↓ Risks</h4>
          <ul>${q.risks.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>
        </div>
      </div>
    </div>

    <div class="block">
      <div class="section-title">Bottom Line</div>
      <div class="bottomline">
        <div class="rating-scale">
          <div class="rating-track" style="position:relative;">
            <div class="rating-marker" style="left:${markerPos.toFixed(1)}%;"></div>
          </div>
          <div class="rating-labels">
            <span>High Risk</span><span>Elevated</span><span>Moderate</span><span>Mod-Low</span><span>Low Risk</span>
          </div>
        </div>
        <div class="verdict-row">
          <div class="verdict-tag" style="color:${bucket.color};background:${hexToRgba(bucket.color, 0.09)};border:1px solid ${hexToRgba(bucket.color, 0.35)};">${bucket.label}</div>
          <div class="verdict-text"><p>${escapeHtml(q.verdict)}</p></div>
        </div>
      </div>
    </div>

    <div class="foot">
      <span>${escapeHtml(d.identity.ticker)} Risk Score Report · Automated analysis, not investment advice</span>
      <span>Generated ${new Date(d.meta.generatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>
    </div>
  </div>`;
}

function buildQuarterlyTable(quarters) {
  if (!quarters || !quarters.length) {
    return `<div style="color:var(--text-faint);font-family:'JetBrains Mono',monospace;font-size:12px;">No quarterly data available.</div>`;
  }
  const rows = quarters
    .map(
      (r, i) => `
      <tr>
        <td>${escapeHtml(r.label)}</td>
        <td>${fmtMoney(r.revenue)}</td>
        <td>${r.grossMarginPct != null ? round1(r.grossMarginPct) + "%" : "N/A"}</td>
        <td>${r.opMarginPct != null ? round1(r.opMarginPct) + "%" : "N/A"}</td>
        <td>${fmtMoney(r.netIncome)}</td>
        <td>${r.eps != null ? "$" + round1(r.eps) : "N/A"}</td>
        <td>${r.fcf != null ? fmtMoney(r.fcf) : "N/A"}</td>
      </tr>`
    )
    .join("");
  return `
  <table class="qtbl">
    <thead><tr><th>Quarter</th><th>Revenue</th><th>Gross Margin</th><th>Op. Margin</th><th>Net Income</th><th>EPS</th><th>Free Cash Flow</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function buildEarningsPanel(d) {
  const latest = d.quarters[d.quarters.length - 1];
  const q = d.quote;
  return `
  <div class="earn-panel">
    <div>
      <h4>${escapeHtml(d.identity.name)} — Latest Reported Quarter${latest ? " (" + escapeHtml(latest.label) + ")" : ""}</h4>
      <p>${escapeHtml(d.qualitative.blurb || "")}</p>
      <p>${latest ? `Revenue came in at <b>${fmtMoney(latest.revenue)}</b> with a gross margin of <b>${latest.grossMarginPct != null ? round1(latest.grossMarginPct) + "%" : "N/A"}</b> and operating margin of <b>${latest.opMarginPct != null ? round1(latest.opMarginPct) + "%" : "N/A"}</b>. Net income was <b>${fmtMoney(latest.netIncome)}</b>, or <b>${latest.eps != null ? "$" + round1(latest.eps) : "N/A"}</b> per diluted share.` : "Quarterly detail is not available for this ticker."}</p>
    </div>
    <div class="mini-stats">
      <div class="mini-stat"><div class="ml">Revenue Growth YoY</div><div class="mv mono ${d.growthRaw.revenueGrowthYoY >= 0 ? "green" : ""}">${d.growthRaw.revenueGrowthYoY != null ? (d.growthRaw.revenueGrowthYoY >= 0 ? "+" : "") + round1(d.growthRaw.revenueGrowthYoY) + "%" : "N/A"}</div></div>
      <div class="mini-stat"><div class="ml">EPS Growth YoY</div><div class="mv mono">${d.growthRaw.epsGrowthYoY != null ? (d.growthRaw.epsGrowthYoY >= 0 ? "+" : "") + round1(d.growthRaw.epsGrowthYoY) + "%" : "N/A"}</div></div>
      <div class="mini-stat"><div class="ml">Cash &amp; ST Inv.</div><div class="mv mono">${d.financialRaw.cashAndSTI != null ? fmtMoney(d.financialRaw.cashAndSTI) : "N/A"}</div></div>
      <div class="mini-stat"><div class="ml">Free Cash Flow</div><div class="mv mono">${d.financialRaw.latestFcf != null ? fmtMoney(d.financialRaw.latestFcf) : "N/A"}</div></div>
      <div class="mini-stat"><div class="ml">Next Earnings</div><div class="mv mono">${q.earningsAnnouncement ? new Date(q.earningsAnnouncement).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "N/A"}</div></div>
      <div class="mini-stat"><div class="ml">Avg. Volume</div><div class="mv mono">${q.avgVolume ? fmtShares(q.avgVolume) : "N/A"}</div></div>
    </div>
  </div>`;
}

// ======================================================================
// helpers
// ======================================================================
function riskBucket(score) {
  if (score <= 33) return { label: "LOW RISK", color: COLORS.green, note: "Balanced fundamentals across valuation, health and growth." };
  if (score <= 50) return { label: "MODERATE-LOW RISK", color: COLORS.green, note: "Mostly favorable signals with a few areas to watch." };
  if (score <= 66) return { label: "MODERATE RISK", color: COLORS.amber, note: "A meaningful mix of strengths and weak spots in the fundamentals." };
  if (score <= 80) return { label: "ELEVATED RISK", color: COLORS.red, note: "Multiple stretched metrics outweigh the positives here." };
  return { label: "HIGH RISK", color: COLORS.red, note: "Valuation, balance sheet, or growth signals are broadly unfavorable." };
}
function riskWord(risk) {
  return risk < 34 ? "Reasonable" : risk < 67 ? "Elevated" : "Stretched";
}
function riskClass(word) {
  return word === "Reasonable" ? "green" : word === "Elevated" ? "amber" : "red";
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function round1(v) {
  if (v == null || Number.isNaN(v)) return v;
  return Math.round(v * 10) / 10;
}
function fmtPrice(v) {
  return v == null ? "N/A" : `$${Number(v).toFixed(2)}`;
}
function fmtAbs(v) {
  return v == null ? "0.00" : Math.abs(Number(v)).toFixed(2);
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
function fmtShares(v) {
  if (v == null) return "N/A";
  if (v >= 1e9) return `${round1(v / 1e9)}B`;
  if (v >= 1e6) return `${round1(v / 1e6)}M`;
  if (v >= 1e3) return `${round1(v / 1e3)}K`;
  return `${v}`;
}
function shortDate(dateStr) {
  const d = new Date(dateStr);
  return `${d.toLocaleString("en-US", { month: "short" })} '${String(d.getFullYear()).slice(2)}`;
}
function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function copySummary() {
  if (!lastData) return;
  const d = lastData;
  const text = `${d.identity.ticker} — ${d.identity.name.toUpperCase()} RISK SCORE REPORT
Price: ${fmtPrice(d.quote.price)} (${d.quote.changePercent >= 0 ? "+" : ""}${round1(d.quote.changePercent)}%) · Market Cap: ${fmtMoney(d.quote.marketCap)} · ${d.identity.exchange}

COMPOSITE RISK SCORE: ${d.score.composite} / 100 — ${riskBucket(d.score.composite).label}
  Valuation (${d.score.breakdown.valuation.weight}% wt.):        ${d.score.breakdown.valuation.risk}/100 risk  ->  ${d.score.breakdown.valuation.pts} pts
  Financial Health (${d.score.breakdown.financialHealth.weight}% wt.): ${d.score.breakdown.financialHealth.risk}/100 risk  ->  ${d.score.breakdown.financialHealth.pts} pts
  Growth (${d.score.breakdown.growth.weight}% wt.):           ${d.score.breakdown.growth.risk}/100 risk  ->  ${d.score.breakdown.growth.pts} pts

KEY METRICS
  Trailing P/E ${fmtX(d.valuationRaw.pe)} · PEG ${fmtNum(d.valuationRaw.peg)} · EV/EBITDA ${fmtX(d.valuationRaw.evEbitda)}
  Current Ratio ${fmtNum(d.financialRaw.currentRatio)} · Debt/Equity ${fmtNum(d.financialRaw.debtEquity)}
  Revenue Growth YoY: ${d.growthRaw.revenueGrowthYoY != null ? round1(d.growthRaw.revenueGrowthYoY) + "%" : "N/A"}
  Next Earnings: ${d.quote.earningsAnnouncement ? new Date(d.quote.earningsAnnouncement).toLocaleDateString() : "N/A"}

VERDICT
${d.qualitative.verdict}

Generated ${new Date(d.meta.generatedAt).toLocaleString()}
Source: Financial Modeling Prep${d.qualitative.source === "claude" ? " · Qualitative copy AI-assisted (Claude)" : ""}`;

  navigator.clipboard
    .writeText(text)
    .then(() => {
      const t = document.getElementById("toast");
      t.classList.add("show");
      setTimeout(() => t.classList.remove("show"), 2200);
    })
    .catch(() => alert("Could not copy automatically — please select and copy manually."));
}
