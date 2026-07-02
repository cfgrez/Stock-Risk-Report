# Stock Risk Score Report

A dark, JetBrains Mono + DM Sans, 2-page risk score report — for **any stock ticker**, generated live. Type a ticker, get a full valuation / financial-health / growth breakdown with a 0–100 composite risk score (35 / 35 / 30 weighting), a 12-month annotated price chart, a quarterly trend table, catalysts vs. risks, and a copy-to-clipboard summary.

Runs entirely on **Cloudflare Pages** (static frontend + a Pages Function as the backend). No server to manage.

```
stock-risk-report/
├── public/              # static frontend (served as-is)
│   ├── index.html
│   ├── style.css
│   └── app.js
├── functions/
│   └── api/
│       └── report.js    # Cloudflare Pages Function → GET /api/report?ticker=XXX
├── wrangler.toml
├── package.json
└── .dev.vars.example
```

## 1. Get a free data API key

The backend pulls quotes, fundamentals, and price history from **[Financial Modeling Prep](https://site.financialmodelingprep.com/developer/docs)**.

1. Create a free account at financialmodelingprep.com.
2. Copy your API key from the dashboard.
3. The free tier covers everything this app needs (quote, profile, ratios, income statement, cash flow, balance sheet, historical prices). Some premium-only fields (e.g. analyst price targets on certain plans) will just render as "N/A" gracefully — the report still works.

Optional: get an **Anthropic API key** from [console.anthropic.com](https://console.anthropic.com) if you want Claude to write the catalysts / risks / bottom-line paragraph instead of the built-in templated summary. Not required — the app works fully without it.

## 2. Push this to your own GitHub repo

```bash
cd stock-risk-report
git init
git add .
git commit -m "Initial commit: stock risk score report"
gh repo create stock-risk-report --public --source=. --push
# or manually:
#   git remote add origin https://github.com/<you>/stock-risk-report.git
#   git branch -M main
#   git push -u origin main
```

## 3. Deploy to Cloudflare Pages

**Option A — Dashboard (recommended, auto-deploys on every push)**

1. Go to the [Cloudflare dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Select your `stock-risk-report` repo.
3. Build settings:
   - **Build command:** *(leave empty — no build step)*
   - **Build output directory:** `public`
   - Cloudflare auto-detects the `/functions` folder at the repo root and deploys it as Pages Functions.
4. Under **Settings → Environment variables**, add as **secrets** (not plaintext):
   - `FMP_API_KEY` = your Financial Modeling Prep key
   - `ANTHROPIC_API_KEY` = your Anthropic key *(optional)*
5. Click **Save and Deploy**. You'll get a `*.pages.dev` URL immediately, and can attach a custom domain under **Custom domains**.

**Option B — CLI**

```bash
npm install
npx wrangler login
npx wrangler pages project create stock-risk-report
npx wrangler pages secret put FMP_API_KEY
npx wrangler pages secret put ANTHROPIC_API_KEY   # optional
npm run deploy
```

## 4. Local development

```bash
npm install
cp .dev.vars.example .dev.vars
# edit .dev.vars and paste in your real FMP_API_KEY (and ANTHROPIC_API_KEY if using it)
npm run dev
```

This serves the app at `http://localhost:8788` with the Pages Function running locally (`wrangler pages dev` auto-loads `.dev.vars`).

## Testing

`test/smoke.test.mjs` runs the full scoring pipeline against mocked API responses (no network needed) to catch regressions:

```bash
npm test
```

## 5. Using it

Open the deployed URL, type any ticker (`AAPL`, `MSFT`, `NVDA`, `TSLA`, `AMZN`, …), hit **Generate**. The ticker is also reflected in the URL hash (`#NVDA`), so you can bookmark or share a direct link to a given report — it re-fetches live data on load.

- **Copy Summary** copies a plain-text digest of the score and verdict to the clipboard.
- **Print / Save PDF** uses the browser print dialog; the two report pages are set up with CSS page breaks so each prints as its own page.

## How the score works

The composite score (0–100, **higher = higher risk**) is a weighted blend of three category sub-scores, each itself an average of a few metric-level risk curves:

| Category | Weight | Inputs |
|---|---|---|
| **Valuation** | 35% | Trailing P/E, PEG, EV/EBITDA, Price/Sales, analyst target vs. price, 52-week range position |
| **Financial Health** | 35% | Current ratio, Debt/Equity, Return on Equity, Free Cash Flow (latest quarter) |
| **Growth** | 30% | Revenue growth YoY, gross margin trend, EPS growth YoY |

Every metric maps through a small "risk curve" function in `functions/api/report.js` (e.g. `riskFromPE`, `riskFromCurrentRatio`, …) — these are simple, transparent, and meant to be tuned. If you disagree with where a threshold sits, edit the constants directly; there's no hidden model.

Missing data for a given ticker doesn't crash the report — any unavailable field defaults to a neutral 50/100 sub-score and renders as "N/A" in the UI.

## Disclaimer

This tool produces an automated, rule-based reading of public fundamentals data. It is **not financial advice** and not a recommendation to buy, hold, or sell any security. Data accuracy depends entirely on the upstream API; always verify against a primary source (company filings, exchange data) before acting on anything shown here.

## License

MIT — do whatever you want with it.
