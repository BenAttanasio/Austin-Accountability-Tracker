import { DatasetConfig, LogEntry } from '@/types';

const SOCRATA_BASE = 'https://data.austintexas.gov/resource';
const API_KEY_ID = process.env.SOCRATA_KEY_ID || '';
const API_KEY_SECRET = process.env.SOCRATA_KEY_SECRET || '';
const PAGE_SIZE = 50000;
const MAX_RETRIES = 4;

// Known dataset IDs — verified against data.austintexas.gov
export const DATASETS: Record<string, DatasetConfig> = {
  contracts: {
    id: '84ih-p28j',
    name: 'Contracts',
    dateField: 'efbgn_dt',
    type: 'financial',
  },
  purchase_orders: {
    id: '3ebq-e9iz',
    name: 'Purchase Orders',
    dateField: 'award_date',
    type: 'financial',
  },
  echeckbook: {
    id: '8c6z-qnmj',
    name: 'eCheckbook / Austin Finance Online',
    dateField: 'chk_eft_iss_dt',
    type: 'financial',
  },
  budget: {
    id: 'yeeq-kk6v',
    name: 'Operating Budget vs Expenditures',
    dateField: 'fy',
    dateFilterMode: 'year',
    type: 'financial',
  },
  campaign_contributions: {
    id: '3kfv-biw6',
    name: 'Campaign Finance Contributions',
    dateField: 'date_reported',
    type: 'campaign',
  },
  campaign_expenditures: {
    id: 'gd3e-xut2',
    name: 'Campaign Finance Expenditures',
    dateField: 'date_reported',
    type: 'campaign',
  },
  campaign_loans: {
    id: 'teb3-cwz9',
    name: 'Campaign Finance Loans',
    dateField: 'date_reported',
    type: 'campaign',
  },
  lobbyist_clients: {
    id: '7ena-g23u',
    name: 'Lobbyist Clients',
    dateField: null,
    type: 'lobbyist',
  },
};

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface FetchOptions {
  mode: 'full' | 'quick';
  onLog?: (entry: LogEntry) => void;
}

function makeAuthHeader(): Record<string, string> {
  if (!API_KEY_ID || !API_KEY_SECRET) return {};
  const encoded = Buffer.from(`${API_KEY_ID}:${API_KEY_SECRET}`).toString('base64');
  return { Authorization: `Basic ${encoded}` };
}

function buildUrl(
  datasetId: string,
  limit: number,
  offset: number,
  mode: 'full' | 'quick',
  dateField: string | null,
  dateFilterMode?: 'date' | 'year'
): string {
  const base = `${SOCRATA_BASE}/${datasetId}.json`;
  const params = new URLSearchParams({
    $limit: limit.toString(),
    $offset: offset.toString(),
  });

  if (mode === 'quick' && dateField) {
    if (dateFilterMode === 'year') {
      // For fiscal year fields (e.g. fy = "2025"), filter by year string
      const cutoffYear = new Date().getFullYear().toString();
      params.set('$where', `${dateField} >= '${cutoffYear}'`);
    } else {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const dateStr = thirtyDaysAgo.toISOString().split('T')[0];
      params.set('$where', `${dateField} >= '${dateStr}'`);
    }
  }

  return `${base}?${params.toString()}`;
}

async function fetchWithRetry(url: string, retries: number = MAX_RETRIES): Promise<unknown[]> {
  const headers = makeAuthHeader();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, { headers });

      if (response.status === 429) {
        const waitTime = Math.pow(2, attempt + 1) * 1000;
        await sleep(waitTime);
        continue;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Socrata API error ${response.status}: ${text}`);
      }

      return await response.json() as unknown[];
    } catch (error) {
      if (attempt === retries) throw error;
      const waitTime = Math.pow(2, attempt + 1) * 1000;
      await sleep(waitTime);
    }
  }

  return [];
}

export async function fetchDataset(
  datasetKey: string,
  options: FetchOptions
): Promise<Record<string, unknown>[]> {
  const config = DATASETS[datasetKey];
  if (!config) throw new Error(`Unknown dataset: ${datasetKey}`);

  const log = (msg: string) => {
    options.onLog?.({
      timestamp: new Date().toISOString(),
      source: 'SOCRATA',
      message: msg,
    });
  };

  log(`Fetching ${config.name} (${config.id})...`);

  const allRecords: Record<string, unknown>[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const url = buildUrl(config.id, PAGE_SIZE, offset, options.mode, config.dateField, config.dateFilterMode);
    const page = await fetchWithRetry(url) as Record<string, unknown>[];

    allRecords.push(...page);
    log(`Retrieved ${allRecords.length} ${config.name} records so far...`);

    if (page.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      offset += PAGE_SIZE;
    }
  }

  log(`Completed: ${allRecords.length} total ${config.name} records`);
  return allRecords;
}

export async function fetchAllDatasets(options: FetchOptions): Promise<Record<string, Record<string, unknown>[]>> {
  const results: Record<string, Record<string, unknown>[]> = {};

  for (const key of Object.keys(DATASETS)) {
    try {
      results[key] = await fetchDataset(key, options);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      options.onLog?.({
        timestamp: new Date().toISOString(),
        source: 'SOCRATA',
        message: `Error fetching ${key}: ${msg}`,
      });
      results[key] = [];
    }
  }

  return results;
}
