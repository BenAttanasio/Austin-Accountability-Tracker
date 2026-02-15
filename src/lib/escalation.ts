import { Finding, WatchlistEntry, LogEntry, Severity } from '@/types';
import { getDatabase } from './mongodb';
import { maxSeverity, normalizeAddress, normalizeName } from './utils';

export async function processEscalations(
  findings: Finding[],
  onLog?: (entry: LogEntry) => void
): Promise<{ newWatchlist: number; escalations: number }> {
  const db = await getDatabase();
  const watchlistCol = db.collection<WatchlistEntry>('watchlist');

  let newWatchlist = 0;
  let escalations = 0;

  const log = (msg: string) => {
    onLog?.({ timestamp: new Date().toISOString(), source: 'DB', message: msg });
  };

  log(`Checking ${findings.length} findings against watchlist...`);

  // Group findings by entity
  const entityFindings = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = normalizeName(f.entity_name);
    if (!entityFindings.has(key)) entityFindings.set(key, []);
    entityFindings.get(key)!.push(f);
  }

  for (const [, entityFlags] of entityFindings) {
    const primaryFinding = entityFlags[0];
    const existing = await watchlistCol.findOne({ entity_name: primaryFinding.entity_name });

    if (!existing) {
      // New watchlist entry
      const highestSev = entityFlags.reduce(
        (acc, f) => maxSeverity(acc, f.ai_severity || f.severity),
        'LOW' as Severity
      );

      await watchlistCol.insertOne({
        entity_name: primaryFinding.entity_name,
        entity_type: primaryFinding.entity_type,
        flag_count: entityFlags.length,
        first_seen: new Date(),
        last_seen: new Date(),
        highest_severity: highestSev,
        related_entities: [],
        history: entityFlags.map(f => f._id!).filter(Boolean),
        notes: '',
      });
      newWatchlist++;
    } else {
      // Update existing
      const newHighest = entityFlags.reduce(
        (acc, f) => maxSeverity(acc, f.ai_severity || f.severity),
        existing.highest_severity
      );

      const wasEscalated = newHighest !== existing.highest_severity;
      if (wasEscalated) escalations++;

      await watchlistCol.updateOne(
        { _id: existing._id },
        {
          $inc: { flag_count: entityFlags.length },
          $set: {
            last_seen: new Date(),
            highest_severity: newHighest,
          },
          $push: {
            history: { $each: entityFlags.map(f => f._id!).filter(Boolean) },
          } as Record<string, unknown>,
        }
      );
    }
  }

  // Cross-entity connections: link entities sharing addresses
  log('Checking cross-entity connections...');
  await linkRelatedEntities();

  log(`${newWatchlist} new watchlist entries, ${escalations} entities escalated`);
  return { newWatchlist, escalations };
}

async function linkRelatedEntities(): Promise<void> {
  const db = await getDatabase();
  const entitiesCol = db.collection('entities');
  const watchlistCol = db.collection<WatchlistEntry>('watchlist');

  // Group entities by address
  const addressGroups = new Map<string, string[]>();
  const entities = await entitiesCol.find({}).toArray();

  for (const entity of entities) {
    for (const addr of (entity.addresses || [])) {
      const normalized = normalizeAddress(addr);
      if (!normalized) continue;
      if (!addressGroups.has(normalized)) addressGroups.set(normalized, []);
      addressGroups.get(normalized)!.push(entity.name);
    }

    // Also group by contact info
    for (const contact of (entity.contacts || [])) {
      const key = `contact:${contact.toLowerCase().trim()}`;
      if (!addressGroups.has(key)) addressGroups.set(key, []);
      addressGroups.get(key)!.push(entity.name);
    }
  }

  // Update related_entities for watchlisted items
  for (const [, group] of addressGroups) {
    if (group.length < 2) continue;

    for (const entityName of group) {
      const related = group.filter(n => n !== entityName);
      await watchlistCol.updateOne(
        { entity_name: entityName },
        { $addToSet: { related_entities: { $each: related } } as Record<string, unknown> }
      );
    }
  }
}

export async function updateEntities(
  data: Record<string, Record<string, unknown>[]>
): Promise<void> {
  const db = await getDatabase();
  const entitiesCol = db.collection('entities');

  const entityMap = new Map<string, {
    name: string;
    type: string;
    addresses: Set<string>;
    contacts: Set<string>;
    departments: Set<string>;
    totalReceived: number;
    totalDonated: number;
    datasets: Set<string>;
  }>();

  function processRecord(r: Record<string, unknown>, dsKey: string, type: string) {
    const nameFields = [
      'lgl_nm',              // contracts, purchase orders, echeckbook
      'client_last_name',    // lobbyist clients
      'vendor_name', 'vendorname', 'vendor', 'payee_name', 'contractor_company',
      'donor_name', 'contributor_name', 'client_name', 'lobbyist_name', 'name',
    ];
    let name = '';
    for (const f of nameFields) {
      if (r[f] && typeof r[f] === 'string') { name = r[f] as string; break; }
    }
    if (!name) return;

    const key = normalizeName(name);
    if (!key) return;

    if (!entityMap.has(key)) {
      entityMap.set(key, {
        name,
        type,
        addresses: new Set(),
        contacts: new Set(),
        departments: new Set(),
        totalReceived: 0,
        totalDonated: 0,
        datasets: new Set(),
      });
    }

    const entity = entityMap.get(key)!;
    entity.datasets.add(dsKey);

    const addr = r['ad_ln_1'] || r['client_adr1'] || r['address'] || r['vendor_address'] || r['street_address'] || '';
    if (addr && typeof addr === 'string') entity.addresses.add(addr);

    const email = r['contract_contact_email_ad'] || r['email'] || r['contact_email'] || '';
    if (email && typeof email === 'string') entity.contacts.add(email);
    const phone = r['contract_contact_voice_ph_no'] || r['phone'] || r['contact_phone'] || '';
    if (phone && typeof phone === 'string') entity.contacts.add(phone);

    const dept = r['dept_nm'] || r['doc_dept_cd'] || r['department_name'] || r['department'] || '';
    if (dept && typeof dept === 'string') entity.departments.add(dept);

    const amount = parseFloat(String(
      r['ma_prch_lmt_am'] || r['itm_tot_am'] || r['amount'] ||
      r['contract_amount'] || r['total_amount'] || r['po_amount'] || r['payment_amount'] || 0
    ).replace(/[$,]/g, '')) || 0;

    if (type === 'donor') {
      entity.totalDonated += amount;
    } else {
      entity.totalReceived += amount;
    }
  }

  // Process financial datasets
  for (const dsKey of ['contracts', 'purchase_orders', 'echeckbook']) {
    for (const r of (data[dsKey] || [])) {
      processRecord(r, dsKey, 'vendor');
    }
  }

  // Process campaign data
  for (const dsKey of ['campaign_contributions']) {
    for (const r of (data[dsKey] || [])) {
      processRecord(r, dsKey, 'donor');
    }
  }

  // Process lobbyist data
  for (const r of (data['lobbyist_clients'] || [])) {
    processRecord(r, 'lobbyist_clients', 'lobbyist');
  }

  // Upsert entities
  for (const [, entity] of entityMap) {
    await entitiesCol.updateOne(
      { name: entity.name },
      {
        $set: {
          name: entity.name,
          type: entity.type,
          last_seen: new Date(),
        },
        $addToSet: {
          addresses: { $each: Array.from(entity.addresses) },
          contacts: { $each: Array.from(entity.contacts) },
          departments: { $each: Array.from(entity.departments) },
          datasets_appeared_in: { $each: Array.from(entity.datasets) },
        } as Record<string, unknown>,
        $inc: {
          total_received: entity.totalReceived,
          total_donated: entity.totalDonated,
        },
        $setOnInsert: {
          first_seen: new Date(),
        },
      },
      { upsert: true }
    );
  }
}
