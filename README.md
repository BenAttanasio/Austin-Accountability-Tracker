# Austin Accountability Tracker

Monitors Austin, TX city government spending through the city's own open data
APIs. It fetches contracts, purchase orders, payments, budgets, campaign finance
records and lobbyist registrations on a schedule, runs anomaly detection over
them, and builds a reputation for every entity it sees. Findings persist, and
entities that keep showing up get escalated.

Everything it reads is public. The value is in cross-referencing datasets that
the city publishes separately and nobody joins up.

> Flags indicate statistical anomalies or pattern matches. They aren't evidence
> of wrongdoing. This exists to surface items worth a human look, by
> investigative journalists, city auditors, and residents.

## Setup

```bash
git clone <your-fork>
cd austin-accountability-tracker
npm install
```

Create `.env.local`:

| Variable | Required | What it's for |
|---|---|---|
| `MONGODB_URI` | Yes | MongoDB Atlas connection string |
| `SOCRATA_KEY_ID` | Yes | Austin Open Data API key id, from data.austintexas.gov |
| `SOCRATA_KEY_SECRET` | Yes | The matching secret |
| `ADMIN_PASSWORD` | Yes | Admin dashboard access |
| `CRON_SECRET` | Yes | Authenticates the scheduled run |
| `ANTHROPIC_API_KEY` | No | Enables the AI pass. Tier 1 works without it |

```bash
npm run dev
```

Then open http://localhost:3000.

To deploy, push to GitHub, import the project in Vercel, add the environment
variables, and deploy. `vercel.json` schedules the daily run for 9:00 UTC, which
is 3am Central.

## What it reads

Eight Socrata datasets from [data.austintexas.gov](https://data.austintexas.gov):

| Dataset | Id | What's in it |
|---|---|---|
| Contracts | `84ih-p28j` | City contracts and awards |
| Purchase Orders | `a5mz-4bkv` | Commodity-level purchase orders |
| eCheckbook | `8c6z-qnmj` | Austin Finance Online payment data |
| Operating Budget | `jmgf-hhk6` | Budget against actual expenditure |
| Campaign Contributions | `3kfv-biw6` | Donations |
| Campaign Expenditures | `gd3e-xut2` | Campaign spending |
| Campaign Loans | `teb3-cwz9` | Campaign finance loans |
| Lobbyist Clients | `kbpn-xpbc` | Registered lobbyist clients |

## Tier 1, the algorithmic checks

These run without an API key and they're where most of the findings come from.

1. **Vendor address clustering.** Several vendors sharing one address.
2. **Vendor anomalies.** New vendors receiving large payments, vendors appearing
   across unrelated departments, near-identical names.
3. **Spending spikes.** Statistical outliers more than two standard deviations
   out.
4. **Campaign donor to contract cross-reference.** Fuzzy name matching between
   donors and vendors.
5. **Lobbyist client to contract cross-reference.** The same, for lobbyist
   clients.
6. **Duplicate payments.** The same amount to the same vendor within days.
7. **Contract amendments.** Contracts that grew more than 25% past their original
   value.
8. **Vague descriptions.** Contracts with generic or missing descriptions.

Checks 4 and 5 are the ones that need multiple datasets at once, and they're the
reason this is a tool rather than a spreadsheet. The city publishes who donated
and who got paid in two different places, and neither one references the other.

## Tier 2, the AI pass

Flagged items go to Claude with the entity's history attached. It assesses
severity, identifies patterns across findings, and suggests what to look at next.
It's optional, and the tool works without a key.

## Flags and the watchlist

A **flag** is one finding from one check in one scan, like "spending spike of
$500K to Vendor X" or "donor and vendor name match at 95% confidence". It carries
its own severity, category, description, and source data, and an admin can
dismiss it.

A **watchlist entry** is the entity-level roll-up. When flags are generated, the
escalation system groups them by entity using normalised name matching, then
creates or updates that entity's entry:

| Field | Behaviour |
|---|---|
| `flag_count` | Every flag ever raised for that entity, across all scans. Only goes up |
| `highest_severity` | The maximum severity the entity has ever hit. Only escalates |
| `related_entities` | Others sharing an address or contact details |
| `history` | Every finding id linked to the entity |

Watchlist severity is derived rather than stored, so an entity that starts with
LOW flags and later gets a HIGH one moves to HIGH permanently.

**Priority investigations** are entries with `flag_count >= 3` or a `CRITICAL`
severity, and they sit at the top of the Watchlist tab.

Making reputation cumulative and one-directional is the design decision that
matters. Any single flag is weak on its own, since a large payment to a new
vendor is usually just a large payment to a new vendor. The pattern worth
looking at is an entity that keeps turning up across different checks and
different months, and that pattern only exists if findings persist and accrue.

## Limitations

- Austin only. The Socrata dataset ids are hardcoded, though the approach ports
  to any city publishing on Socrata.
- Name matching is fuzzy, so common surnames and company names generate false
  positives. That's the cost of catching "Smith Construction LLC" against "Smith
  Construction Company".
- Data is only as current as the city's own publishing schedule, which varies by
  dataset.
- Flags never expire or decay. An entity flagged once carries it permanently,
  which is deliberate and does mean the watchlist grows in one direction.

## License

MIT. See [LICENSE](LICENSE).

More at [benattanasio.com/lab](https://benattanasio.com/lab).
