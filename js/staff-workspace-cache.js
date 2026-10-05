/* Session-only read snapshots. Never persist staff records or credentials to browser storage. */
(function (root) {
  const lists = ['list'];
  const reads = {
    '/api/admin': ['shell', 'section'],
    '/api/income-analytics': ['report'],
    '/api/staff-hr': lists,
    '/api/staff-conduct': lists,
    '/api/staff-library': lists,
    '/api/finance-workflow': lists,
    '/api/staff-stores': lists,
    '/api/staff-departments': lists,
    '/api/staff-members': lists,
    '/api/staff-organization-departments': lists,
    '/api/staff-services': lists,
    '/api/staff-funds': lists,
    '/api/staff-church-payments': lists,
    '/api/staff-offerings': lists,
    '/api/staff-correspondence': ['bootstrap', 'list', 'search'],
    '/api/staff-academics': ['bootstrap', 'list', 'getacademicmanagement', 'getacademicscorebookcontext'],
    '/api/staff-homework': ['getcontext'],
    '/api/external-audit': ['list', 'findings', 'catalog', 'records', 'reports'],
    '/api/staff-payroll': ['list'],
    '/api/staff-hotel': ['list']
  };
  // These reads deliberately remain live: identity/permissions, approvals,
  // device status, money-moving checks, attendance and protected files.
  const liveReads = new Set(['list', 'status', 'admin-status', 'quick', 'presencequick', 'search',
    'detail', 'document', 'catalog', 'findings', 'reports', 'exportregister', 'recordexport',
    'searchcustomers', 'getbalance', 'tax-breakdown', 'previewhomework']);
  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
    return value;
  }
  function requestPolicy(url, init) {
    const method = String(init.method || 'GET').toUpperCase();
    let body = {};
    if (init.body) {
      if (typeof init.body !== 'string') return { cacheable: false, mutation: !['GET', 'HEAD'].includes(method) };
      try { body = JSON.parse(init.body); } catch (_) { return { cacheable: false, mutation: true }; }
    }
    const action = String(body.action || body.Action || url.searchParams.get('action')
      || (url.pathname === '/api/admin' ? body.mode || 'shell'
        : url.pathname === '/api/income-analytics' ? 'report'
          : method === 'GET' ? 'list' : '')).toLowerCase();
    const hasSensitiveInput = /"[^"\n]*(?:password|secret|token|approvalproof)[^"\n]*"\s*:/i.test(init.body || '');
    const cacheable = ['GET', 'POST'].includes(method) && !hasSensitiveInput
      && (reads[url.pathname] || []).includes(action);
    const mutation = !['GET', 'HEAD'].includes(method) && !cacheable && !liveReads.has(action);
    return { cacheable, mutation, key: JSON.stringify([url.pathname, url.search, method, stable(body)]) };
  }
  function create({ context, onInvalidate = () => {}, maxEntries = 512, maxBytes = 40 * 1024 * 1024 }) {
    const entries = new Map();
    let scope = '', signal = null, revision = 0, bytes = 0, wasExpired = false;
    function clear() {
      entries.clear(); bytes = 0; revision++; onInvalidate();
    }
    function current() {
      const next = context();
      if (scope !== next.scope || signal !== next.signal) {
        clear(); scope = next.scope; signal = next.signal; wasExpired = false;
      }
      if (!wasExpired && next.expiresAt && next.expiresAt <= Date.now()) { clear(); wasExpired = true; }
      return next;
    }
    function version() { current(); return revision; }
    function valid(start, rev) {
      const now = current();
      return rev === revision && now.scope === start.scope && now.signal === start.signal
        && !start.signal?.aborted && !(now.expiresAt && now.expiresAt <= Date.now());
    }
    function stale() { throw new DOMException('The workspace changed while records were loading.', 'AbortError'); }
    function response(value) {
      return new Response(value.text, { status: value.status, statusText: value.statusText,
        headers: { 'Content-Type': value.contentType } });
    }
    async function fetch(url, init, network) {
      const policy = requestPolicy(url, init);
      const start = current();
      if (policy.mutation) clear();
      const rev = revision;
      const eligible = policy.cacheable && start.scope && !start.signal?.aborted && !init.signal?.aborted
        && !(start.expiresAt && start.expiresAt <= Date.now());
      if (!eligible) {
        try { return await network(); }
        finally { if (policy.mutation) clear(); }
      }
      let entry = entries.get(policy.key);
      if (!entry) {
        entry = { bytes: 0, promise: null };
        entry.promise = (async () => {
          const result = await network();
          if (!valid(start, rev)) stale();
          const text = await result.clone().text();
          if (!valid(start, rev)) stale();
          let data;
          try { data = JSON.parse(text); } catch (_) { /* Not cacheable. */ }
          if (!result.ok || data?.ok !== true) {
            if (entries.get(policy.key) === entry) entries.delete(policy.key);
            return { original: result };
          }
          const value = { text, status: result.status, statusText: result.statusText,
            contentType: result.headers.get('Content-Type') || 'application/json' };
          entry.bytes = new TextEncoder().encode(text).byteLength;
          bytes += entry.bytes;
          // Never evict a pending request: callers share it until it completes.
          for (const [key, candidate] of entries) {
            if (entries.size <= maxEntries && bytes <= maxBytes) break;
            if (!candidate.bytes) continue;
            entries.delete(key); bytes -= candidate.bytes;
          }
          return value;
        })().catch((error) => {
          if (entries.get(policy.key) === entry) entries.delete(policy.key);
          throw error;
        });
        entries.set(policy.key, entry);
      }
      const value = await entry.promise;
      if (!valid(start, rev) || init.signal?.aborted) stale();
      return value.original ? value.original.clone() : response(value);
    }
    return { fetch, clear, version };
  }
  root.DynamaxWorkspaceCache = { create, requestPolicy };
})(typeof window === 'undefined' ? globalThis : window);
