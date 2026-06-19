# Austin Accountability Tracker

Public accountability tool that monitors Austin, TX city government spending using open data APIs. It autonomously fetches financial records, contracts, campaign contributions, and lobbyist data from data.austintexas.gov, then runs algorithmic anomaly detection and AI-powered analysis to flag potential irregularities, conflicts of interest, and suspicious patterns. Findings are stored persistently and escalated as patterns emerge over time.

## Local Setup

```bash
git clone <repo-url>
cd austin-accountability-tracker
npm install
```

Create `.env.local` with the following variables:

```env
# MongoDB Atlas connection string
MONGODB_URI=mongodb+srv://...

# Austin Open Data API credentials (get from data.austintexas.gov)
SOCRATA_KEY_ID=your_key_id
SOCRATA_KEY_SECRET=your_key_secret

# Anthropic Claude API key (optional - Tier 1 analysis works without it)
ANTHROPIC_API_KEY=sk-ant-...

# Admin password for the dashboard
ADMIN_PASSWORD=your_password

# Cron secret for Vercel scheduled runs
CRON_SECRET=your_random_secret
```

Run locally:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGODB_URI` | Yes | MongoDB Atlas connection string |
| `SOCRATA_KEY_ID` | Yes | Austin Open Data API key ID |
| `SOCRATA_KEY_SECRET` | Yes | Austin Open Data API key secret |
| `ANTHROPIC_API_KEY` | No | Enables AI-powered Tier 2 analysis |
| `ADMIN_PASSWORD` | Yes | Password for admin dashboard access |
| `CRON_SECRET` | Yes | Secret for authenticating cron requests |

## Deploy to Vercel

1. Push to GitHub
2. Import project in Vercel
3. Add all environment variables in Vercel project settings
4. Deploy

The daily cron job runs at 9 AM UTC (3 AM Central) automatically via `vercel.json` configuration.

## Data Sources

All data from [data.austintexas.gov](https://data.austintexas.gov) public Socrata APIs:

- **Contracts** (84ih-p28j) - City contracts and awards
- **Purchase Orders** (a5mz-4bkv) - Commodity-level purchase orders
- **eCheckbook** (8c6z-qnmj) - Austin Finance Online payment data
- **Operating Budget** (jmgf-hhk6) - Budget vs actual expenditures
- **Campaign Contributions** (3kfv-biw6) - Campaign finance donations
- **Campaign Expenditures** (gd3e-xut2) - Campaign spending
- **Campaign Loans** (teb3-cwz9) - Campaign finance loans
- **Lobbyist Clients** (kbpn-xpbc) - Registered lobbyist clients

## How the Analysis Works

### Tier 1: Algorithmic Checks (No AI Required)

1. **Vendor Address Clustering** - Flags multiple vendors sharing the same address
2. **Vendor Anomaly Detection** - Flags new vendors with large payments, cross-department vendors, similar names
3. **Spending Spike Detection** - Statistical outlier detection (>2 standard deviations)
4. **Campaign-to-Contract Cross-Reference** - Fuzzy matches between donors and vendors
5. **Lobbyist-to-Contract Cross-Reference** - Fuzzy matches between lobbyist clients and vendors
6. **Duplicate Payment Detection** - Same amounts to same vendor within days
7. **Contract Amendment Tracking** - Contracts exceeding original amount by >25%
8. **Vague Description Flagging** - Contracts with generic or missing descriptions

### Tier 2: AI Analysis (Requires Anthropic API Key)

Flagged items are sent to Claude for forensic financial analysis with entity history context. The AI assesses severity, identifies patterns, and recommends investigative next steps.

### Flags vs Watchlist

**Flags** are individual findings — each one is a specific anomaly detected by a single analysis check during a scan (e.g., "spending spike of $500K to Vendor X" or "donor-vendor name match at 95% confidence"). A flag has its own severity, category, description, and source data. Flags can be dismissed by admins.

**Watchlist entries** are entity-level roll-ups. When flags are generated, the escalation system groups them by entity (using normalized name matching) and creates or updates a watchlist entry. A watchlist entry tracks:

- **`flag_count`** — cumulative total of all flags ever generated for that entity across all scans (only goes up)
- **`highest_severity`** — the maximum severity across all of that entity's flags (only escalates, never downgrades)
- **`related_entities`** — other entities that share addresses or contact info with this one
- **`history`** — array of all finding IDs linked to this entity

So the watchlist severity is **dynamically derived** — it's the highest severity of any flag that entity has ever received. If an entity starts with LOW flags and later gets a HIGH flag, the watchlist severity upgrades to HIGH permanently.

**Priority Investigations** are watchlist entries where `flag_count >= 3` OR `highest_severity === 'CRITICAL'`. These appear at the top of the Watchlist tab with red highlighting.

### Escalation System

Entities build a reputation over time. Flag counts only increase. Severity only goes up. Entities with 3+ flags or CRITICAL severity are marked as priority investigations.

## Legal Notice

All data is sourced from public government APIs at data.austintexas.gov. Flags indicate statistical anomalies or pattern matches, **not confirmed wrongdoing**. This tool is designed to surface items worthy of further human review by investigative journalists, city auditors, and concerned citizens.

## License

Released under the [MIT License](LICENSE).
