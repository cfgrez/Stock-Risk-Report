# Stock Risk Score Report

A dark, JetBrains Mono + DM Sans, 2-page risk score report — for **any stock ticker**, generated live. Type a ticker, get a full valuation / financial-health / growth breakdown with a 0–100 composite risk score (35 / 35 / 30 weighting), a 12-month annotated price chart, a quarterly trend table, catalysts vs. risks, and a copy-to-clipboard summary.

Runs as a single **Cloudflare Worker** using [Workers static assets](https://developers.cloudflare.com/workers/static-assets/) — one script serves the static frontend *and* the API route. No separate Pages project, no build step.

```
stock-risk-report/
├── public/              # static frontend, served directly via the ASSETS binding
│   ├── index.html
│   ├── style.css
│   └── app.js
├── src/
│   ├── index.js          # Worker entry — routes /api/report vs. static files
│   └── report.js         # fetches fundamentals, computes the risk score
├── test/
│   └── smoke.test.mjs    # end-to-end test with mocked API responses
├── wrangler.toml
└── package.json
```

## 1. Get a free data API key

The backend pulls quotes, fundamentals, and price history from **[Financial Modeling Prep](https://site.financialmodelingprep.com/developer/docs)**.

1. Create a free account at financialmodelingprep.com.
2. Copy your API key from the dashboard.
3. The free tier covers everything this app needs (quote, profile, ratios, income statement, cash flow, balance sheet, historical prices). Any field that isn't available on your plan just renders as "N/A" — the report still works.

Optional: get an **Anthropic API key** from [console.anthropic.com](https://console.anthropic.com) if you want Claude to write the catalysts / risks / bottom-line paragraph instead of the built-in templated summary. Not required.

## 2. Push this to your own GitHub repo

```bash
cd stock-risk-report
git init   # skip if you unzipped a copy that already has a .git folder
git add -A
git commit -m "Stock risk score report — Cloudflare Worker"
gh repo create stock-risk-report --public --source=. --push
# or manually:
#   git remote add origin https://github.com/<you>/stock-risk-report.git
#   git branch -M main
#   git push -u origin main
```

## 3. Deploy to Cloudflare Workers

```bash
npm install
npx wrangler login

npx wrangler secret put FMP_API_KEY
# paste your key when prompted

npx wrangler secret put ANTHROPIC_API_KEY   # optional
# paste your key, or press enter to skip

npm run deploy
```

That's it — `wrangler deploy` reads `wrangler.toml`, uploads `src/index.js` as the Worker, uploads everything in `public/` as static assets, and gives you a URL like:

```
https://stock-risk-report.<your-subdomain>.workers.dev
```

**Custom domain (optional):** in the Cloudflare dashboard → **Workers & Pages** → your Worker → **Settings → Domains & Routes** → **Add** → attach any domain/subdomain on a zone in your Cloudflare account.

**Re-deploying after changes:** just run `npm run deploy` again (or push to GitHub and re-run it — this repo doesn't have Git-triggered auto-deploy set up; that's a Pages-only feature. For auto-deploy on push with plain Workers, add a GitHub Action that runs `wrangler deploy` with `CLOUDFLARE_API_TOKEN` as a repo secret).

## 4. Local development

```bash
npm install
cp .dev.vars.example .dev.vars
# edit .dev.vars and paste in your real FMP_API_KEY (and ANTHROPIC_API_KEY if using it)
npm run dev
```

`wrangler dev` serves the app locally (default `http://localhost:8787`), running the exact same Worker code — static assets and `/api/report` both work locally.

## Testing

`test/smoke.test.mjs` runs the full scoring pipeline against mocked API responses (no network needed):

```bash
npm test
```

## Using it

Open the deployed URL, type any ticker (`AAPL`, `MSFT`, `NVDA`, `TSLA`, `AMZN`, …), hit **Generate**. The ticker is reflected in the URL hash (`#NVDA`), so you can bookmark or share a direct link — it re-fetches live data on load.

- **Copy Summary** copies a plain-text digest of the score and verdict to the clipboard.
- **Print / Save PDF** uses the browser print dialog; the two report pages use CSS page breaks so each prints as its own page.

## How the score works

The composite score (0–100, **higher = higher risk**) is a weighted blend of three category sub-scores, each an average of a few metric-level risk curves:

| Category | Weight | Inputs |
|---|---|---|
| **Valuation** | 35% | Trailing P/E, PEG, EV/EBITDA, Price/Sales, analyst target vs. price, 52-week range position |
| **Financial Health** | 35% | Current ratio, Debt/Equity, Return on Equity, Free Cash Flow (latest quarter) |
| **Growth** | 30% | Revenue growth YoY, gross margin trend, EPS growth YoY |

Every metric maps through a small "risk curve" function in `src/report.js` (`riskFromPE`, `riskFromCurrentRatio`, …) — simple, transparent, and meant to be tuned. Missing data for a given ticker defaults to a neutral 50/100 sub-score and renders as "N/A" rather than crashing the report.

## Disclaimer

This tool produces an automated, rule-based reading of public fundamentals data. It is **not financial advice** and not a recommendation to buy, hold, or sell any security. Data accuracy depends entirely on the upstream API; always verify against a primary source before acting on anything shown here.

## License

MIT — do whatever you want with it.
