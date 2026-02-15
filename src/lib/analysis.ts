import {
  AnalysisFlag, LogEntry, Severity,
} from '@/types';
import {
  normalizeName, normalizeAddress, levenshtein, matchConfidence,
  isSuspiciouslySimilar, isVagueDescription, parseAmount, stdDev,
  socrataViewUrl,
} from './utils';
import { DATASETS } from './socrata';

type LogFn = (entry: LogEntry) => void;

function log(onLog: LogFn | undefined, source: LogEntry['source'], message: string) {
  onLog?.({ timestamp: new Date().toISOString(), source, message });
}

// Helper to extract vendor/entity name from various dataset schemas
function getEntityName(record: Record<string, unknown>, _dataset: string): string {
  const fields = [
    'vendor_name', 'vendorname', 'vendor', 'payee_name', 'payee',
    'contractor_company', 'company_name', 'name',
    'donor_name', 'contributor_name', 'first_name_of_contributor',
    'client_name', 'lobbyist_name',
  ];
  for (const f of fields) {
    if (record[f] && typeof record[f] === 'string') return record[f] as string;
  }
  // For campaign, try combining first/last
  if (record['first_name_of_contributor'] && record['last_name_of_contributor']) {
    return `${record['first_name_of_contributor']} ${record['last_name_of_contributor']}`;
  }
  return String(record['vendor_name'] || record['name'] || 'Unknown');
}

function getAddress(record: Record<string, unknown>): string {
  const fields = ['address', 'vendor_address', 'street_address', 'mailing_address', 'address_1'];
  for (const f of fields) {
    if (record[f] && typeof record[f] === 'string') return record[f] as string;
  }
  return '';
}

function getDepartment(record: Record<string, unknown>): string {
  const fields = ['department_name', 'department', 'dept_name', 'dept', 'division'];
  for (const f of fields) {
    if (record[f] && typeof record[f] === 'string') return record[f] as string;
  }
  return '';
}

function getAmount(record: Record<string, unknown>): number {
  const fields = [
    'contract_amount', 'amount', 'total_amount', 'award_amount',
    'po_amount', 'payment_amount', 'expenditure_amount',
    'contribution_amount', 'loan_amount', 'check_amount',
  ];
  for (const f of fields) {
    if (record[f] !== undefined) return parseAmount(record[f]);
  }
  return 0;
}

function getDescription(record: Record<string, unknown>): string {
  const fields = ['description', 'contract_description', 'commodity_description', 'purpose', 'item_description'];
  for (const f of fields) {
    if (record[f] && typeof record[f] === 'string') return record[f] as string;
  }
  return '';
}

function getDate(record: Record<string, unknown>): Date | null {
  const fields = [
    'start_date', 'po_date', 'payment_date', 'date_reported',
    'transaction_date', 'check_date', 'creation_date',
  ];
  for (const f of fields) {
    if (record[f]) {
      const d = new Date(String(record[f]));
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}

// ===========================================
// 1. VENDOR ADDRESS CLUSTERING
// ===========================================
export function analyzeAddressClusters(
  data: Record<string, Record<string, unknown>[]>,
  onLog?: LogFn
): AnalysisFlag[] {
  log(onLog, 'ANALYSIS', 'Running vendor address clustering...');
  const flags: AnalysisFlag[] = [];

  const addressMap = new Map<string, Set<string>>();
  const financialDatasets = ['contracts', 'purchase_orders', 'echeckbook'];

  for (const dsKey of financialDatasets) {
    const records = data[dsKey] || [];
    for (const r of records) {
      const addr = normalizeAddress(getAddress(r));
      const name = getEntityName(r, dsKey);
      if (!addr || !name) continue;

      if (!addressMap.has(addr)) addressMap.set(addr, new Set());
      addressMap.get(addr)!.add(name);
    }
  }

  for (const [address, vendors] of addressMap) {
    if (vendors.size >= 2) {
      const vendorList = Array.from(vendors);
      // Verify they have different normalized names
      const uniqueNormalized = new Set(vendorList.map(normalizeName));
      if (uniqueNormalized.size >= 2) {
        const severity: Severity = vendors.size >= 4 ? 'HIGH' : vendors.size >= 3 ? 'MEDIUM' : 'LOW';
        flags.push({
          entity_name: vendorList[0],
          entity_type: 'vendor',
          category: 'address_cluster',
          severity,
          description: `${vendors.size} vendors share the same address: ${vendorList.join(', ')}. Address: ${address}`,
          raw_data: { address, vendors: vendorList },
          source_dataset: '84ih-p28j',
          source_url: socrataViewUrl('84ih-p28j'),
        });
      }
    }
  }

  log(onLog, 'FLAG', `${flags.length} vendor address clusters found`);
  return flags;
}

// ===========================================
// 2. VENDOR ANOMALY DETECTION
// ===========================================
export function analyzeVendorAnomalies(
  data: Record<string, Record<string, unknown>[]>,
  onLog?: LogFn
): AnalysisFlag[] {
  log(onLog, 'ANALYSIS', 'Running vendor anomaly detection...');
  const flags: AnalysisFlag[] = [];

  // Build vendor profiles
  const vendorProfiles = new Map<string, {
    name: string;
    totalReceived: number;
    departments: Set<string>;
    firstSeen: Date | null;
    records: Record<string, unknown>[];
  }>();

  const financialDatasets = ['contracts', 'purchase_orders', 'echeckbook'];

  for (const dsKey of financialDatasets) {
    const records = data[dsKey] || [];
    for (const r of records) {
      const name = getEntityName(r, dsKey);
      const normalized = normalizeName(name);
      if (!normalized) continue;

      if (!vendorProfiles.has(normalized)) {
        vendorProfiles.set(normalized, {
          name,
          totalReceived: 0,
          departments: new Set(),
          firstSeen: null,
          records: [],
        });
      }

      const profile = vendorProfiles.get(normalized)!;
      profile.totalReceived += getAmount(r);
      const dept = getDepartment(r);
      if (dept) profile.departments.add(dept);
      const date = getDate(r);
      if (date && (!profile.firstSeen || date < profile.firstSeen)) {
        profile.firstSeen = date;
      }
      profile.records.push(r);
    }
  }

  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  for (const [, profile] of vendorProfiles) {
    // New vendor with large payments
    if (
      profile.firstSeen &&
      profile.firstSeen > twelveMonthsAgo &&
      profile.totalReceived > 50000
    ) {
      flags.push({
        entity_name: profile.name,
        entity_type: 'vendor',
        category: 'vendor_anomaly',
        severity: profile.totalReceived > 200000 ? 'HIGH' : 'MEDIUM',
        description: `New vendor (first seen ${profile.firstSeen.toISOString().split('T')[0]}) has received ${formatUSD(profile.totalReceived)} in less than 12 months.`,
        raw_data: {
          total_received: profile.totalReceived,
          first_seen: profile.firstSeen.toISOString(),
          department_count: profile.departments.size,
        },
        source_dataset: '84ih-p28j',
        source_url: socrataViewUrl('84ih-p28j'),
      });
    }

    // Payments from 3+ unrelated departments
    if (profile.departments.size >= 3) {
      flags.push({
        entity_name: profile.name,
        entity_type: 'vendor',
        category: 'vendor_anomaly',
        severity: 'MEDIUM',
        description: `Vendor receives payments from ${profile.departments.size} different departments: ${Array.from(profile.departments).join(', ')}.`,
        raw_data: {
          departments: Array.from(profile.departments),
          total_received: profile.totalReceived,
        },
        source_dataset: '84ih-p28j',
        source_url: socrataViewUrl('84ih-p28j'),
      });
    }
  }

  // Check for suspiciously similar names
  const vendorNames = Array.from(vendorProfiles.keys());
  for (let i = 0; i < vendorNames.length && i < 2000; i++) {
    for (let j = i + 1; j < vendorNames.length && j < 2000; j++) {
      if (isSuspiciouslySimilar(vendorNames[i], vendorNames[j])) {
        const p1 = vendorProfiles.get(vendorNames[i])!;
        const p2 = vendorProfiles.get(vendorNames[j])!;
        flags.push({
          entity_name: p1.name,
          entity_type: 'vendor',
          category: 'similar_names',
          severity: 'LOW',
          description: `Vendor "${p1.name}" has a suspiciously similar name to "${p2.name}". Combined receipts: ${formatUSD(p1.totalReceived + p2.totalReceived)}.`,
          raw_data: {
            vendor_1: p1.name,
            vendor_2: p2.name,
            total_1: p1.totalReceived,
            total_2: p2.totalReceived,
            levenshtein_distance: levenshtein(vendorNames[i], vendorNames[j]),
          },
          source_dataset: '84ih-p28j',
          source_url: socrataViewUrl('84ih-p28j'),
        });
      }
    }
  }

  log(onLog, 'FLAG', `${flags.length} vendor anomalies found`);
  return flags;
}

function formatUSD(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ===========================================
// 3. SPENDING SPIKE DETECTION
// ===========================================
export function analyzeSpendingSpikes(
  data: Record<string, Record<string, unknown>[]>,
  onLog?: LogFn
): AnalysisFlag[] {
  log(onLog, 'ANALYSIS', 'Running spending spike detection...');
  const flags: AnalysisFlag[] = [];

  // Group payments by vendor
  const vendorPayments = new Map<string, { name: string; amounts: number[]; dates: (Date | null)[] }>();

  const financialDatasets = ['contracts', 'purchase_orders', 'echeckbook'];
  for (const dsKey of financialDatasets) {
    const records = data[dsKey] || [];
    for (const r of records) {
      const name = getEntityName(r, dsKey);
      const normalized = normalizeName(name);
      const amount = getAmount(r);
      if (!normalized || amount === 0) continue;

      if (!vendorPayments.has(normalized)) {
        vendorPayments.set(normalized, { name, amounts: [], dates: [] });
      }
      vendorPayments.get(normalized)!.amounts.push(amount);
      vendorPayments.get(normalized)!.dates.push(getDate(r));
    }
  }

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  for (const [, vp] of vendorPayments) {
    if (vp.amounts.length < 3) continue;

    const { mean, std: sd } = stdDev(vp.amounts);

    // Check for individual payments > 2 std devs above mean
    for (let i = 0; i < vp.amounts.length; i++) {
      if (sd > 0 && vp.amounts[i] > mean + 2 * sd) {
        flags.push({
          entity_name: vp.name,
          entity_type: 'vendor',
          category: 'spending_spike',
          severity: vp.amounts[i] > mean + 3 * sd ? 'HIGH' : 'MEDIUM',
          description: `Payment of ${formatUSD(vp.amounts[i])} to ${vp.name} is ${((vp.amounts[i] - mean) / sd).toFixed(1)} standard deviations above their average of ${formatUSD(mean)}.`,
          raw_data: {
            payment_amount: vp.amounts[i],
            average: mean,
            std_dev: sd,
          },
          source_dataset: '84ih-p28j',
          source_url: socrataViewUrl('84ih-p28j'),
        });
      }

      // Single payment > $100K when average < $20K
      if (vp.amounts[i] > 100000 && mean < 20000) {
        flags.push({
          entity_name: vp.name,
          entity_type: 'vendor',
          category: 'spending_spike',
          severity: 'HIGH',
          description: `Single payment of ${formatUSD(vp.amounts[i])} to ${vp.name} whose average payment is only ${formatUSD(mean)}.`,
          raw_data: {
            payment_amount: vp.amounts[i],
            average: mean,
          },
          source_dataset: '84ih-p28j',
          source_url: socrataViewUrl('84ih-p28j'),
        });
      }
    }
  }

  log(onLog, 'FLAG', `${flags.length} spending spikes found`);
  return flags;
}

// ===========================================
// 4. CAMPAIGN FINANCE TO CONTRACT CROSS-REFERENCE
// ===========================================
export function analyzeDonorVendorMatches(
  data: Record<string, Record<string, unknown>[]>,
  onLog?: LogFn
): AnalysisFlag[] {
  log(onLog, 'ANALYSIS', 'Running campaign finance to contract cross-reference...');
  const flags: AnalysisFlag[] = [];

  // Build donor list
  const donors = new Map<string, { name: string; total: number; records: Record<string, unknown>[] }>();
  const contributions = data['campaign_contributions'] || [];
  for (const r of contributions) {
    const name = getEntityName(r, 'campaign_contributions');
    const normalized = normalizeName(name);
    if (!normalized) continue;
    if (!donors.has(normalized)) {
      donors.set(normalized, { name, total: 0, records: [] });
    }
    donors.get(normalized)!.total += getAmount(r);
    donors.get(normalized)!.records.push(r);
  }

  // Build vendor list from contracts/POs
  const vendors = new Map<string, { name: string; total: number; departments: Set<string> }>();
  for (const dsKey of ['contracts', 'purchase_orders']) {
    const records = data[dsKey] || [];
    for (const r of records) {
      const name = getEntityName(r, dsKey);
      const normalized = normalizeName(name);
      if (!normalized) continue;
      if (!vendors.has(normalized)) {
        vendors.set(normalized, { name, total: 0, departments: new Set() });
      }
      vendors.get(normalized)!.total += getAmount(r);
      const dept = getDepartment(r);
      if (dept) vendors.get(normalized)!.departments.add(dept);
    }
  }

  // Cross-reference
  for (const [donorNorm, donor] of donors) {
    for (const [vendorNorm, vendor] of vendors) {
      const confidence = matchConfidence(donorNorm, vendorNorm);
      if (confidence >= 80) {
        const severity: Severity =
          confidence >= 95 && donor.total > 1000 && vendor.total > 50000
            ? 'HIGH'
            : confidence >= 90
            ? 'MEDIUM'
            : 'LOW';

        flags.push({
          entity_name: donor.name,
          entity_type: 'donor',
          category: 'donor_vendor_match',
          severity,
          description: `Campaign donor "${donor.name}" matches vendor "${vendor.name}" (${confidence}% confidence). Donated: ${formatUSD(donor.total)}. Received in contracts: ${formatUSD(vendor.total)}.`,
          raw_data: {
            donor_name: donor.name,
            vendor_name: vendor.name,
            match_confidence: confidence,
            donation_total: donor.total,
            contract_total: vendor.total,
            departments: Array.from(vendor.departments),
          },
          source_dataset: '3kfv-biw6',
          source_url: socrataViewUrl('3kfv-biw6'),
        });
      }
    }
  }

  log(onLog, 'FLAG', `${flags.length} donor-vendor matches found`);
  return flags;
}

// ===========================================
// 5. LOBBYIST TO CONTRACT CROSS-REFERENCE
// ===========================================
export function analyzeLobbyistVendorMatches(
  data: Record<string, Record<string, unknown>[]>,
  onLog?: LogFn
): AnalysisFlag[] {
  log(onLog, 'ANALYSIS', 'Running lobbyist to contract cross-reference...');
  const flags: AnalysisFlag[] = [];

  // Build lobbyist client list
  const lobbyistClients = new Map<string, { name: string; records: Record<string, unknown>[] }>();
  const lobbyists = data['lobbyist_clients'] || [];
  for (const r of lobbyists) {
    const name = String(r['client_name'] || r['client'] || r['name'] || '');
    const normalized = normalizeName(name);
    if (!normalized) continue;
    if (!lobbyistClients.has(normalized)) {
      lobbyistClients.set(normalized, { name, records: [] });
    }
    lobbyistClients.get(normalized)!.records.push(r);
  }

  // Build vendor list
  const vendors = new Map<string, { name: string; total: number; departments: Set<string> }>();
  for (const dsKey of ['contracts', 'purchase_orders']) {
    const records = data[dsKey] || [];
    for (const r of records) {
      const name = getEntityName(r, dsKey);
      const normalized = normalizeName(name);
      if (!normalized) continue;
      if (!vendors.has(normalized)) {
        vendors.set(normalized, { name, total: 0, departments: new Set() });
      }
      vendors.get(normalized)!.total += getAmount(r);
      const dept = getDepartment(r);
      if (dept) vendors.get(normalized)!.departments.add(dept);
    }
  }

  // Cross-reference
  for (const [clientNorm, client] of lobbyistClients) {
    for (const [vendorNorm, vendor] of vendors) {
      const confidence = matchConfidence(clientNorm, vendorNorm);
      if (confidence >= 80) {
        flags.push({
          entity_name: client.name,
          entity_type: 'lobbyist',
          category: 'lobbyist_vendor_match',
          severity: confidence >= 95 ? 'HIGH' : 'MEDIUM',
          description: `Lobbyist client "${client.name}" matches vendor "${vendor.name}" (${confidence}% confidence). Contract value: ${formatUSD(vendor.total)}.`,
          raw_data: {
            client_name: client.name,
            vendor_name: vendor.name,
            match_confidence: confidence,
            contract_total: vendor.total,
            departments: Array.from(vendor.departments),
          },
          source_dataset: 'kbpn-xpbc',
          source_url: socrataViewUrl('kbpn-xpbc'),
        });
      }
    }
  }

  log(onLog, 'FLAG', `${flags.length} lobbyist-vendor matches found`);
  return flags;
}

// ===========================================
// 6. DUPLICATE PAYMENT DETECTION
// ===========================================
export function analyzeDuplicatePayments(
  data: Record<string, Record<string, unknown>[]>,
  onLog?: LogFn
): AnalysisFlag[] {
  log(onLog, 'ANALYSIS', 'Running duplicate payment detection...');
  const flags: AnalysisFlag[] = [];

  // Group by vendor + amount
  const paymentMap = new Map<string, { date: Date | null; amount: number; record: Record<string, unknown> }[]>();

  for (const dsKey of ['contracts', 'purchase_orders', 'echeckbook']) {
    const records = data[dsKey] || [];
    for (const r of records) {
      const name = normalizeName(getEntityName(r, dsKey));
      const amount = getAmount(r);
      const date = getDate(r);
      if (!name || amount === 0) continue;

      if (!paymentMap.has(name)) paymentMap.set(name, []);
      paymentMap.get(name)!.push({ date, amount, record: r });
    }
  }

  for (const [vendorName, payments] of paymentMap) {
    // Sort by date
    payments.sort((a, b) => {
      if (!a.date || !b.date) return 0;
      return a.date.getTime() - b.date.getTime();
    });

    for (let i = 0; i < payments.length; i++) {
      for (let j = i + 1; j < payments.length; j++) {
        const p1 = payments[i];
        const p2 = payments[j];

        // Exact amount, within 3 business days
        if (p1.amount === p2.amount && p1.date && p2.date) {
          const daysDiff = Math.abs(p1.date.getTime() - p2.date.getTime()) / (1000 * 60 * 60 * 24);
          if (daysDiff <= 5) { // ~3 business days
            flags.push({
              entity_name: vendorName,
              entity_type: 'vendor',
              category: 'duplicate_payment',
              severity: p1.amount > 10000 ? 'HIGH' : 'MEDIUM',
              description: `Duplicate payment of ${formatUSD(p1.amount)} to ${vendorName} within ${Math.round(daysDiff)} days.`,
              raw_data: {
                amount: p1.amount,
                date_1: p1.date.toISOString(),
                date_2: p2.date.toISOString(),
                days_apart: Math.round(daysDiff),
              },
              source_dataset: '84ih-p28j',
              source_url: socrataViewUrl('84ih-p28j'),
            });
          }
        }

        // Within 1% same vendor same week
        if (p1.date && p2.date) {
          const daysDiff = Math.abs(p1.date.getTime() - p2.date.getTime()) / (1000 * 60 * 60 * 24);
          if (daysDiff <= 7 && p1.amount > 0 && p2.amount > 0) {
            const pctDiff = Math.abs(p1.amount - p2.amount) / Math.max(p1.amount, p2.amount) * 100;
            if (pctDiff > 0 && pctDiff <= 1 && p1.amount > 5000) {
              flags.push({
                entity_name: vendorName,
                entity_type: 'vendor',
                category: 'duplicate_payment',
                severity: 'MEDIUM',
                description: `Suspiciously similar payments to ${vendorName}: ${formatUSD(p1.amount)} and ${formatUSD(p2.amount)} (${pctDiff.toFixed(2)}% difference) within ${Math.round(daysDiff)} days.`,
                raw_data: {
                  amount_1: p1.amount,
                  amount_2: p2.amount,
                  pct_difference: pctDiff,
                  days_apart: Math.round(daysDiff),
                },
                source_dataset: '84ih-p28j',
                source_url: socrataViewUrl('84ih-p28j'),
              });
            }
          }
        }
      }
    }
  }

  log(onLog, 'FLAG', `${flags.length} potential duplicate payments found`);
  return flags;
}

// ===========================================
// 7. CONTRACT AMENDMENT TRACKING
// ===========================================
export function analyzeContractAmendments(
  data: Record<string, Record<string, unknown>[]>,
  onLog?: LogFn
): AnalysisFlag[] {
  log(onLog, 'ANALYSIS', 'Running contract amendment tracking...');
  const flags: AnalysisFlag[] = [];

  const contracts = data['contracts'] || [];
  for (const r of contracts) {
    const original = parseAmount(r['original_amount'] || r['contract_amount'] || 0);
    const current = parseAmount(r['current_amount'] || r['extended_amount'] || r['total_amount'] || 0);

    if (original > 0 && current > original) {
      const increase = ((current - original) / original) * 100;
      if (increase > 25) {
        const name = getEntityName(r, 'contracts');
        flags.push({
          entity_name: name,
          entity_type: 'vendor',
          category: 'contract_amendment',
          severity: increase > 100 ? 'HIGH' : increase > 50 ? 'MEDIUM' : 'LOW',
          description: `Contract with ${name} has increased ${increase.toFixed(0)}% from ${formatUSD(original)} to ${formatUSD(current)}.`,
          raw_data: {
            original_amount: original,
            current_amount: current,
            increase_pct: increase,
            contract_id: r['contract_id'] || r['purchase_order_number'] || 'unknown',
          },
          source_dataset: '84ih-p28j',
          source_url: socrataViewUrl('84ih-p28j'),
        });
      }
    }
  }

  log(onLog, 'FLAG', `${flags.length} contract amendments flagged`);
  return flags;
}

// ===========================================
// 8. VAGUE DESCRIPTION FLAGGING
// ===========================================
export function analyzeVagueDescriptions(
  data: Record<string, Record<string, unknown>[]>,
  onLog?: LogFn
): AnalysisFlag[] {
  log(onLog, 'ANALYSIS', 'Running vague description detection...');
  const flags: AnalysisFlag[] = [];

  for (const dsKey of ['contracts', 'purchase_orders']) {
    const records = data[dsKey] || [];
    for (const r of records) {
      const desc = getDescription(r);
      const amount = getAmount(r);

      if (isVagueDescription(desc) && amount > 10000) {
        const name = getEntityName(r, dsKey);
        flags.push({
          entity_name: name,
          entity_type: 'vendor',
          category: 'vague_description',
          severity: amount > 100000 ? 'HIGH' : amount > 50000 ? 'MEDIUM' : 'LOW',
          description: `${formatUSD(amount)} contract/PO with ${name} has vague description: "${desc || '(blank)'}".`,
          raw_data: {
            description: desc || '(blank)',
            amount,
            dataset: dsKey,
          },
          source_dataset: DATASETS[dsKey]?.id || dsKey,
          source_url: socrataViewUrl(DATASETS[dsKey]?.id || dsKey),
        });
      }
    }
  }

  log(onLog, 'FLAG', `${flags.length} vague descriptions flagged`);
  return flags;
}

// ===========================================
// RUN ALL TIER 1 ANALYSES
// ===========================================
export function runTier1Analysis(
  data: Record<string, Record<string, unknown>[]>,
  onLog?: LogFn
): AnalysisFlag[] {
  log(onLog, 'ANALYSIS', 'Starting Tier 1 analysis (algorithmic checks)...');

  const allFlags: AnalysisFlag[] = [
    ...analyzeAddressClusters(data, onLog),
    ...analyzeVendorAnomalies(data, onLog),
    ...analyzeSpendingSpikes(data, onLog),
    ...analyzeDonorVendorMatches(data, onLog),
    ...analyzeLobbyistVendorMatches(data, onLog),
    ...analyzeDuplicatePayments(data, onLog),
    ...analyzeContractAmendments(data, onLog),
    ...analyzeVagueDescriptions(data, onLog),
  ];

  log(onLog, 'ANALYSIS', `Tier 1 complete: ${allFlags.length} total flags generated`);
  return allFlags;
}
