function clean(value, maximum = 120) {
  return String(value ?? '').trim().replace(/[\r\n\t]+/g, ' ').slice(0, maximum);
}

function elapsedMilliseconds(startedAt) {
  const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  return Math.max(0, Math.round((now - startedAt) * 100) / 100);
}

export function startRequestMetric(request, route) {
  const startedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  const url = new URL(request.url);
  return {
    requestId: clean(request.headers.get('cf-ray') || crypto.randomUUID(), 80),
    route: clean(route || url.pathname, 160),
    method: clean(request.method, 12),
    startedAt
  };
}

export function finishRequestMetric(metric, details = {}) {
  const entry = {
    type: 'request_metric',
    requestId: metric.requestId,
    route: metric.route,
    method: metric.method,
    action: clean(details.action, 80),
    status: Number(details.status || 500),
    outcome: clean(details.outcome || (Number(details.status) < 400 ? 'ok' : 'error'), 40),
    durationMs: elapsedMilliseconds(metric.startedAt)
  };
  if (Number.isFinite(Number(details.received))) entry.received = Number(details.received);
  if (Number.isFinite(Number(details.processed))) entry.processed = Number(details.processed);
  console.log(JSON.stringify(entry));
  return entry;
}
