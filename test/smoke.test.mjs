import { handleReport } from "../src/report.js";

const mockQuote = [{
  symbol: "TEST", price: 413.56, change: -11.89, changesPercentage: -2.79,
  marketCap: 1550000000000, sharesOutstanding: 3760000000,
  yearHigh: 498.83, yearLow: 288.77, avgVolume: 58000000, volume: 54000000,
  pe: 380.6, exchange: "NASDAQ", earningsAnnouncement: "2026-07-22T20:00:00.000Z",
}];
const mockProfile = [{ companyName: "Test Corp", sector: "Technology", industry: "Software", city: "Austin", country: "US", beta: 1.8, exchangeShortName: "NASDAQ" }];
const mockRatios = [{ priceToEarningsRatioTTM: 380.6, priceToEarningsGrowthRatioTTM: 4.23, priceToSalesRatioTTM: 15.9, currentRatioTTM: 2.04, debtToEquityRatioTTM: 0.19 }];
const mockKM = [{ evToEBITDATTM: 129.9, returnOnInvestedCapitalTTM: 0.0634, returnOnEquityTTM: 0.049, currentRatioTTM: 2.04, debtToEquityTTM: 0.19 }];
function q(rev, gp, oi, ni, eps, period, year, date) {
  return { date, period, calendarYear: String(year), revenue: rev, grossProfitRatio: gp, operatingIncomeRatio: oi, netIncome: ni, eps };
}
const mockIncomeQ = [
  q(19335e6, 0.163, 0.021, 409e6, 0.12, "Q1", 2025, "2025-03-31"),
  q(22496e6, 0.172, 0.041, 1172e6, 0.33, "Q2", 2025, "2025-06-30"),
  q(28095e6, 0.180, 0.058, 1373e6, 0.39, "Q3", 2025, "2025-09-30"),
  q(24901e6, 0.201, 0.057, 840e6, 0.24, "Q4", 2025, "2025-12-31"),
  q(22387e6, 0.211, 0.042, 477e6, 0.13, "Q1", 2026, "2026-03-31"),
].reverse(); // FMP returns newest first
const mockCashQ = mockIncomeQ.map((i) => ({ date: i.date, freeCashFlow: 1000e6 }));
const mockBalanceQ = [{ cashAndShortTermInvestments: 44740e6 }];
const historical = [];
for (let i = 0; i < 260; i++) {
  const d = new Date(2025, 6, 1 + i);
  historical.push({ date: d.toISOString().slice(0, 10), close: 300 + Math.sin(i / 20) * 100 + i * 0.3 });
}
const mockHistorical = { historical: historical.reverse() };
const mockPT = [{ targetConsensus: 410, targetHigh: 600, targetLow: 24.86 }];

global.fetch = async (url) => {
  const body =
    url.includes("/quote?") ? mockQuote :
    url.includes("/profile?") ? mockProfile :
    url.includes("/ratios-ttm?") ? mockRatios :
    url.includes("/key-metrics-ttm?") ? mockKM :
    url.includes("/income-statement?") ? mockIncomeQ :
    url.includes("/cash-flow-statement?") ? mockCashQ :
    url.includes("/balance-sheet-statement?") ? mockBalanceQ :
    url.includes("/historical-price-eod/full") ? mockHistorical :
    url.includes("price-target-consensus") ? mockPT :
    [];
  return { ok: true, status: 200, json: async () => body };
};

const req = new Request("https://example.com/api/report?ticker=TEST");
const res = await handleReport(req, { FMP_API_KEY: "mock" });
const data = await res.json();
console.log("status:", res.status);
console.log("composite score:", data.score?.composite);
console.log("breakdown:", JSON.stringify(data.score?.breakdown));
console.log("quarters:", data.quarters?.length, "prices:", data.prices?.length);
console.log("valuation signals:", data.signals?.valuation?.length, "financial:", data.signals?.financialHealth?.length, "growth:", data.signals?.growth?.length);
console.log("qualitative source:", data.qualitative?.source);
console.log("sample signal:", JSON.stringify(data.signals.valuation[0]));
if (!data.score || typeof data.score.composite !== "number") throw new Error("Missing composite score");
console.log("SMOKE TEST PASSED");
