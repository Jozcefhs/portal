import { requireFirestoreEnv } from '../lib/firestore.js';
import { branchRecordVisible } from '../lib/branch-scope.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { loadAggregatedSecurityAudit } from '../lib/security-audit.js';
import { readJsonBody } from '../lib/request-security.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

function ensureAuditAccess(user) {
  if (user.role === 'Super Admin' || (user.allowedSections || []).includes('securityAudit')) return;
  const error = new Error('Your role is not permitted to view the security audit log.');
  error.status = 403;
  throw error;
}

function defaultDate(daysAgo = 30) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function validDate(value, fallback) {
  return /^\d{4}-\d{2}-\d{2}$/.test(clean(value)) ? clean(value) : fallback;
}

function uniqueOptions(rows, getter) {
  return [...new Set(rows.map(getter).map(clean).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function includesValue(rowValue, wanted) {
  return !clean(wanted) || lower(rowValue) === lower(wanted);
}

function matchesUser(row, wanted) {
  if (!clean(wanted)) return true;
  const value = lower(wanted);
  return [row.ActorUsername, row.Actor, row.Subject].some((entry) => lower(entry) === value);
}

function filterRows(rows, body) {
  const search = lower(body.search);
  return rows.filter((row) => includesValue(row.Action, body.actionFilter)
    && matchesUser(row, body.user)
    && includesValue(row.Module, body.module)
    && includesValue(row.Outcome, body.outcome)
    && includesValue(row.SourcePlatform, body.source)
    && includesValue(row.BranchId, body.branchId)
    && (!search || [
      row.Action, row.Module, row.Actor, row.ActorUsername, row.Subject,
      row.EntityType, row.EntityId, row.BranchId, row.Details, row.Route,
      row.RequestId
    ].some((value) => lower(value).includes(search))));
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 24 * 1024 });
    const action = lower(body.action || 'list');
    ensureAuditAccess(user);
    if (action === 'print') {
      return Response.json({ ok: true, message: 'Security audit print view prepared.' }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action !== 'list') {
      const error = new Error('Unknown security-audit action.');
      error.status = 400;
      throw error;
    }
    const today = new Date().toISOString().slice(0, 10);
    const fromDate = validDate(body.fromDate, defaultDate(30));
    const toDate = validDate(body.toDate, today);
    if (fromDate > toDate) {
      const error = new Error('The audit start date cannot be after the end date.');
      error.status = 400;
      throw error;
    }
    const aggregate = await loadAggregatedSecurityAudit(env, { fromDate, toDate, perSourceLimit: 300 });
    const visible = aggregate.rows.filter((row) => branchRecordVisible(row, user));
    const facets = {
      actions: uniqueOptions(visible, (row) => row.Action),
      users: uniqueOptions(visible.flatMap((row) => [
        { value: row.ActorUsername || row.Actor },
        { value: row.Subject }
      ]), (row) => row.value),
      modules: uniqueOptions(visible, (row) => row.Module),
      outcomes: uniqueOptions(visible, (row) => row.Outcome),
      sources: uniqueOptions(visible, (row) => row.SourcePlatform),
      branches: uniqueOptions(visible, (row) => row.BranchId)
    };
    const filtered = filterRows(visible, body);
    const limit = Math.min(1500, Math.max(50, Number(body.limit || 1000) || 1000));
    return Response.json({
      ok: true,
      fromDate,
      toDate,
      rows: filtered.slice(0, limit),
      totalMatches: filtered.length,
      truncated: filtered.length > limit,
      warnings: aggregate.warnings,
      facets
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || String(error) }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
