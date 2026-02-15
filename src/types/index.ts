import { ObjectId } from 'mongodb';

// Severity levels
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

// Entity types
export type EntityType = 'vendor' | 'donor' | 'lobbyist' | 'employee';

// Finding categories
export type FlagCategory =
  | 'address_cluster'
  | 'spending_spike'
  | 'donor_vendor_match'
  | 'duplicate_payment'
  | 'vague_description'
  | 'contract_amendment'
  | 'lobbyist_vendor_match'
  | 'vendor_anomaly'
  | 'similar_names';

// Run types
export type RunType = 'daily_cron' | 'manual_full' | 'manual_quick';
export type RunStatus = 'running' | 'completed' | 'failed';

// Log sources
export type LogSource = 'SOCRATA' | 'ANALYSIS' | 'AI' | 'DB' | 'CRON' | 'SYSTEM' | 'FLAG';

export interface LogEntry {
  timestamp: string;
  source: LogSource;
  message: string;
}

// Database document types
export interface Finding {
  _id?: ObjectId;
  entity_name: string;
  entity_type: EntityType;
  category: FlagCategory;
  severity: Severity;
  description: string;
  raw_data: Record<string, unknown>;
  source_dataset: string;
  source_url: string;
  ai_analysis: string | null;
  ai_severity: Severity | null;
  created_at: Date;
  run_id: string;
  dismissed?: boolean;
  dismissed_reason?: string;
  dismissed_at?: Date;
}

export interface WatchlistEntry {
  _id?: ObjectId;
  entity_name: string;
  entity_type: EntityType;
  flag_count: number;
  first_seen: Date;
  last_seen: Date;
  highest_severity: Severity;
  related_entities: string[];
  history: ObjectId[];
  notes: string;
}

export interface Entity {
  _id?: ObjectId;
  name: string;
  type: EntityType;
  addresses: string[];
  contacts: string[];
  departments: string[];
  total_received: number;
  total_donated: number;
  datasets_appeared_in: string[];
  first_seen: Date;
  last_seen: Date;
}

export interface Run {
  _id?: ObjectId;
  run_id: string;
  started_at: Date;
  completed_at: Date | null;
  type: RunType;
  records_fetched: Record<string, number>;
  flags_generated: number;
  new_watchlist_entries: number;
  escalations: number;
  status: RunStatus;
  log: LogEntry[];
}

// Socrata dataset configuration
export interface DatasetConfig {
  id: string;
  name: string;
  dateField: string;
  type: 'financial' | 'campaign' | 'lobbyist';
}

// Analysis results
export interface AnalysisFlag {
  entity_name: string;
  entity_type: EntityType;
  category: FlagCategory;
  severity: Severity;
  description: string;
  raw_data: Record<string, unknown>;
  source_dataset: string;
  source_url: string;
}

// Cross-reference match
export interface CrossRefMatch {
  donor_name: string;
  vendor_name: string;
  match_confidence: number;
  donation_total: number;
  contract_total: number;
  departments: string[];
}

// API response types
export interface StatusResponse {
  last_run: Run | null;
  data_freshness: Record<string, { last_fetched: string; status: 'fresh' | 'stale' | 'old' }>;
  flag_counts: Record<Severity, number>;
  total_findings: number;
  total_watchlist: number;
}
