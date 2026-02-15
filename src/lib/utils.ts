// String normalization for entity matching
export function normalizeName(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/\b(llc|inc|corp|ltd|co|company|incorporated|limited|corporation)\b/gi, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Levenshtein distance for fuzzy name matching
export function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
}

// Match confidence based on string similarity (0-100)
export function matchConfidence(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);

  if (na === nb) return 100;
  if (!na || !nb) return 0;

  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);

  if (maxLen === 0) return 0;

  const similarity = ((maxLen - dist) / maxLen) * 100;
  return Math.round(similarity);
}

// Check if two names are a fuzzy match
export function isFuzzyMatch(a: string, b: string, threshold: number = 85): boolean {
  return matchConfidence(a, b) >= threshold;
}

// Check if a name is suspiciously similar (Levenshtein < 3 on normalized)
export function isSuspiciouslySimilar(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return false; // exact match, not suspicious - same entity
  return levenshtein(na, nb) < 3;
}

// Format currency
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// Format date for display (Central Time)
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

// Safely parse a number from Socrata data
export function parseAmount(val: unknown): number {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[$,]/g, '');
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

// Extract address for clustering
export function normalizeAddress(addr: string): string {
  if (!addr) return '';
  return addr
    .toLowerCase()
    .replace(/\b(suite|ste|apt|unit|#|floor|fl|room|rm)\b\.?\s*/gi, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// VAGUE_TERMS for description flagging
export const VAGUE_TERMS = [
  'fees', 'services', 'consulting', 'supplies', 'support', 'maintenance',
  'professional services', 'miscellaneous', 'various', 'other', 'general',
  'tbd', 'n/a', 'na', 'none', 'see attached', 'as needed', 'misc',
];

export function isVagueDescription(desc: string): boolean {
  if (!desc || !desc.trim()) return true;

  const normalized = desc.toLowerCase().trim();
  // Check if the entire description is just vague terms
  const words = normalized.split(/\s+/);
  const vagueWords = words.filter(w =>
    VAGUE_TERMS.includes(w) || VAGUE_TERMS.some(t => t === normalized)
  );

  // If ALL words are vague terms, flag it
  return vagueWords.length === words.length || VAGUE_TERMS.includes(normalized);
}

// Generate Socrata source URL
export function socrataUrl(datasetId: string): string {
  return `https://data.austintexas.gov/resource/${datasetId}.json`;
}

export function socrataViewUrl(datasetId: string): string {
  return `https://data.austintexas.gov/d/${datasetId}`;
}

// Standard deviation calculation
export function stdDev(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squareDiffs = values.map(v => Math.pow(v - mean, 2));
  const variance = squareDiffs.reduce((a, b) => a + b, 0) / values.length;
  return { mean, std: Math.sqrt(variance) };
}

// Compare severities
const SEVERITY_ORDER = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 } as const;

export function maxSeverity(a: string, b: string): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  const aVal = SEVERITY_ORDER[a as keyof typeof SEVERITY_ORDER] ?? 0;
  const bVal = SEVERITY_ORDER[b as keyof typeof SEVERITY_ORDER] ?? 0;
  return aVal >= bVal ? a as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' : b as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}
