// Shared web/PWA maintenance flow. Preview batches never post financial changes.
export function studentMaintenanceRequest(fetchStaff, { signal, sessionSignal, isCurrent = () => true, timeoutMs = 60000 } = {}) {
  return async (url, payload) => {
    if (!isCurrent()) throw new Error('The branch or signed-in user changed. Reopen Students before continuing.');
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    const signals = [signal, sessionSignal].filter(Boolean);
    for (const source of signals) { source.addEventListener('abort', abort, { once: true }); if (source.aborted) abort(); }
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      if (controller.signal.aborted) throw new DOMException('Request cancelled.', 'AbortError');
      const response = await fetchStaff(url, { method: 'POST', credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!isCurrent()) throw new Error('The branch or signed-in user changed. Reopen Students before continuing.');
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The server did not return a valid response. Refresh Students and try again.');
      const data = await response.json();
      if (controller.signal.aborted) throw new DOMException('Request cancelled.', 'AbortError');
      if (!isCurrent()) throw new Error('The branch or signed-in user changed. Reopen Students before continuing.');
      if (!response.ok || data?.ok !== true) throw new Error(data?.message || 'The student maintenance request failed.');
      return data;
    } catch (error) {
      if (timedOut) throw new Error(payload.action === 'applyProfileDefaults'
        ? 'The save response timed out. Some defaults may already be saved. Run this action again to recheck the remaining defaults.'
        : 'The server took too long to respond. The read-only check stopped; no financial records changed. Try again.');
      throw error;
    } finally {
      clearTimeout(timer);
      for (const source of signals) source.removeEventListener('abort', abort);
    }
  };
}

export async function saveStudentProfileDefaults(request, onProgress = () => {}) {
  let updated = 0;
  try {
    for (let batch = 0; batch < 200; batch += 1) {
      const preview = await request('/api/staff-students', { action: 'previewProfileDefaults' });
      if (!Number.isInteger(preview.remaining) || preview.remaining < 0) throw new Error('The defaults preview was incomplete. No further saves were attempted.');
      if (!preview.remaining) return { updated };
      onProgress({ updated, remaining: preview.remaining });
      const result = await request('/api/staff-students', { action: 'applyProfileDefaults', PreviewToken: preview.previewToken });
      if (!Number.isInteger(result.updated) || result.updated <= 0 || !Number.isInteger(result.remaining) || result.remaining < 0) {
        throw new Error('The save could not be confirmed. Run this action again to recheck the remaining defaults.');
      }
      updated += result.updated;
      onProgress({ updated, remaining: result.remaining });
      if (!result.remaining) return { updated };
    }
    throw new Error('The maintenance batch limit was reached. Run this action again to finish remaining profiles.');
  } catch (error) { error.updated = updated; throw error; }
}

export async function reviewAllStudentBilling(request, onProgress = () => {}) {
  const roster = await request('/api/student-billing-reconciliation', { action: 'previewAll', paged: true });
  const profiles = roster.pendingProfiles;
  if (!Array.isArray(profiles) || !Array.isArray(roster.rows) || !Number.isInteger(roster.total) ||
      !Number.isInteger(roster.incomplete) || roster.incomplete < 0 ||
      roster.total !== roster.incomplete + roster.rows.length + profiles.length ||
      profiles.some((row) => !row.AccountRef || typeof row.revision !== 'string') ||
      new Set(profiles.map((row) => row.AccountRef.toLowerCase())).size !== profiles.length) {
    throw new Error('The roster was incomplete. No billing totals or posting controls were shown. Run a fresh review.');
  }
  const report = { ...roster, rows: [...roster.rows] };
  let checked = roster.incomplete + roster.rows.length;
  onProgress({ checked, total: roster.total });
  for (let offset = 0; offset < profiles.length; offset += 10) {
    const batch = profiles.slice(offset, offset + 10);
    const page = await request('/api/student-billing-reconciliation', { action: 'previewBatch', Profiles: batch, ConfigurationToken: roster.configurationToken });
    if (!Array.isArray(page.rows) || page.checked !== batch.length || !Number.isInteger(page.matched) || page.matched < 0 ||
        page.matched + page.rows.length !== batch.length) {
      throw new Error('A billing batch was incomplete. No partial report or posting controls were shown. Run a fresh review.');
    }
    report.rows.push(...page.rows);
    report.matched += page.matched;
    checked += page.checked;
    onProgress({ checked, total: roster.total });
  }
  report.ready = report.rows.filter((row) => row.ready).length;
  report.review = report.rows.length - report.ready;
  report.rows.sort((a, b) => a.profile.AccountRef.localeCompare(b.profile.AccountRef));
  return report;
}
