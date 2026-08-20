import { listCollection } from './firestore.js';

const REFERENCE_CACHE_MS = 60 * 1000;
let chartCache = null;

function clean(value) {
  return String(value ?? '').trim();
}

function environmentKey(env = {}) {
  return [
    clean(env.FIREBASE_PROJECT_ID),
    clean(env.DYNAMAX_WORKSPACE_ID),
    clean(env.ORGANISATION_EDITION || env.ORGANIZATION_EDITION)
  ].join('|');
}

export async function getAccountingChartRows(env, options = {}) {
  const key = environmentKey(env);
  const now = Date.now();
  if (!options.fresh && chartCache?.key === key && chartCache.expiresAt > now) {
    return chartCache.rows;
  }
  const rows = await listCollection(env, 'chartOfAccounts');
  chartCache = { key, rows, expiresAt: now + REFERENCE_CACHE_MS };
  return rows;
}

export function primeAccountingChartRows(env, rows) {
  chartCache = {
    key: environmentKey(env),
    rows: Array.isArray(rows) ? rows : [],
    expiresAt: Date.now() + REFERENCE_CACHE_MS
  };
}

export function invalidateAccountingChartRows() {
  chartCache = null;
}

export { REFERENCE_CACHE_MS };
