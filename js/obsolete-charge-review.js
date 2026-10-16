import { prepareBoardingWearBulk, postBoardingWearBulk, reviewedBoardingWearPlan } from './boarding-wear-bulk.js?v=20261005-1';

const ref = row => String(row?.profile?.AccountRef || '').trim();
const escaped = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const money = value => `₦${Number(value || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const adapter = request => payload => request({ ...payload, action: payload.action === 'previewReversal' ? 'previewObsoleteReversal' : 'applyObsoleteReversal' });
export const prepareObsoleteCharges = (rows, request, progress) => prepareBoardingWearBulk(rows, adapter(request), progress);
export const postObsoleteCharges = (rows, reason, request, progress) => postBoardingWearBulk(rows, reason, adapter(request), progress);

export async function reviewObsoleteChargeAccounts(request, progress = () => {}) {
  const roster = await request({ action: 'obsoleteRoster' }), profiles = roster.pendingProfiles;
  if (!Array.isArray(profiles) || !Array.isArray(roster.rows) || !Number.isInteger(roster.total) ||
    roster.total !== profiles.length + roster.rows.length || !roster.configurationToken ||
    profiles.some(row => !row.AccountRef || typeof row.revision !== 'string') ||
    new Set(profiles.map(row => row.AccountRef.toLowerCase())).size !== profiles.length) throw new Error('The student roster is incomplete. Run a fresh review.');
  const report = { ...roster, rows: [...roster.rows], matched: 0 };
  let checked = roster.rows.length;
  for (let offset = 0; offset < profiles.length; offset += 10) {
    progress(checked, roster.total);
    const batch = profiles.slice(offset, offset + 10);
    const page = await request({ action: 'obsoleteBatch', Profiles: batch, ConfigurationToken: roster.configurationToken });
    if (!Array.isArray(page.rows) || page.checked !== batch.length || !Number.isInteger(page.matched) || page.matched < 0 ||
      page.matched + page.rows.length !== batch.length || new Set(page.rows.map(row => ref(row).toLowerCase())).size !== page.rows.length ||
      page.rows.some(row => !batch.some(profile => profile.AccountRef.toLowerCase() === ref(row).toLowerCase()))) throw new Error('A review batch is incomplete. No posting controls are available; run a fresh review.');
    report.rows.push(...page.rows); report.matched += page.matched; checked += page.checked;
  }
  progress(checked, roster.total);
  return report;
}

export function obsoleteChargeTable(plans, verified = false) {
  return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Student / period</th><th>Charges to reverse</th><th>Bill before → after</th><th>Existing allocation released</th><th>Review</th></tr></thead><tbody>${plans.map(plan =>
    `<tr><td>${escaped(plan.profile?.DisplayName || '')}<br>${escaped(ref(plan))}<br>${escaped(plan.profile?.ClassName || '')} · ${escaped(plan.profile?.SchoolSection || '')}<br>${escaped(plan.profile?.AcademicSession || '')} · ${escaped(plan.profile?.Term || '')}</td>
    <td>${(plan.charges || []).map(charge => `${escaped(charge.name)} (${escaped(charge.code)}): ${money(charge.amount)}<br><small>${escaped(charge.invoiceId)}</small>`).join('<br>') || 'Not verified'}</td>
    <td>${plan.postedTotal == null ? 'Not verified' : `${money(plan.postedTotal)} → ${money(plan.afterPostedTotal)}<br><small>Current fee setup: ${money(plan.expectedTotal)}</small>`}</td>
    <td>${plan.releasedCredit == null ? 'Not verified' : money(plan.releasedCredit)}</td>
    <td>${escaped(verified && reviewedBoardingWearPlan(plan) ? 'Verified — included in approval' : plan.reason || 'Candidate — receipt and journal checks required')}</td></tr>`).join('')}</tbody></table></div>`;
}

export async function openObsoleteChargeReview({ dialog, content, request, isCurrent, confirm, notify, readOnly = false }) {
  const subtitle = dialog.querySelector('.workflow-dialog-header small');
  if (subtitle) {
    const original = subtitle.textContent;
    subtitle.textContent = 'Reviewed finance correction';
    dialog.addEventListener('close', () => { subtitle.textContent = original; }, { once: true });
  }
  content.innerHTML = '<h3>Review obsolete textbook / yearbook charges</h3><p>Checking every class in the permitted branch and school sections. This review does not change financial records.</p><p role="status" aria-live="polite" data-obsolete-status></p>';
  if (!dialog.open) dialog.showModal();
  const status = () => content.querySelector('[data-obsolete-status]');
  const progress = text => { if (isCurrent() && status()) status().textContent = text; };
  try {
    const report = await reviewObsoleteChargeAccounts(request, (checked, total) => progress(`Checked ${checked} of ${total} profiles…`));
    if (!isCurrent()) return;
    content.innerHTML = `<h3>Obsolete textbook / yearbook charge review</h3><p>${report.total} profiles checked; ${report.rows.length} accounts flagged; ${report.matched} have no obsolete charges identified. Changed or ambiguous profiles stay flagged for rechecking.</p>
      <p>Only returning-only textbook/yearbook charges that do not apply to the student's New Intake classification can qualify. Valid fees, payments and receipts are preserved. Other conflicts require separate finance review.</p>
      ${obsoleteChargeTable(report.rows)}${report.rows.length && !readOnly ? '<button type="button" data-prepare-obsolete>Prepare correction for all affected students</button>' : ''}<p role="status" aria-live="polite" data-obsolete-status></p>`;
    content.querySelector('[data-prepare-obsolete]')?.addEventListener('click', async event => {
      const prepareButton = event.currentTarget;
      if (prepareButton.disabled) return;
      prepareButton.disabled = true; prepareButton.textContent = 'Checking financial evidence…';
      try {
        const plans = await prepareObsoleteCharges(report.rows, request, (index, total, reference) => progress(`Checking receipts and journals ${index} of ${total}: ${reference}. No changes made.`));
        if (!isCurrent()) return;
        const eligible = plans.filter(reviewedBoardingWearPlan), blocked = plans.length - eligible.length;
        const amount = eligible.reduce((sum, plan) => sum + plan.amount, 0);
        const released = eligible.reduce((sum, plan) => sum + plan.releasedCredit, 0);
        content.innerHTML = `<h3>Textbook / yearbook correction — ready for approval</h3><p>${eligible.length} accounts ready; ${blocked} require further review.</p>
          <p><strong>Charges to reverse: ${money(amount)}. Existing allocations released: ${money(released)}.</strong></p>
          <p>Each account is revalidated and committed atomically. Original invoice amounts, payments and receipts stay intact. Released allocations remain available for valid fees; no new payment, refund or wallet credit is created.</p>
          ${obsoleteChargeTable(plans, true)}${eligible.length ? '<label>Approval reason<textarea data-obsolete-reason maxlength="500" required></textarea></label><button type="button" data-post-obsolete>Approve and post all eligible reversals</button>' : ''}<p role="status" aria-live="polite" data-obsolete-status></p>`;
        content.querySelector('[data-post-obsolete]')?.addEventListener('click', async event => {
          const post = event.currentTarget, reason = content.querySelector('[data-obsolete-reason]').value.trim();
          if (post.disabled) return;
          if (!reason) { await notify('Approval reason required', 'Enter a reason before approving these corrections.', 'error'); return; }
          post.disabled = true;
          if (!await confirm({ title: 'Approve obsolete fee charge reversals', message: `Reverse ${money(amount)} across ${eligible.length} accounts? ${blocked} blocked accounts are excluded. No payments or receipts will be deleted. Keep this review open until results are shown.`, confirmText: 'Approve and post all' })) { post.disabled = false; return; }
          post.textContent = 'Posting reviewed corrections…';
          let posted = 0, message = '';
          try {
            const outcomes = await postObsoleteCharges(eligible, reason, request, (index, total, reference) => progress(`Posting ${index} of ${total}: ${reference}…`));
            if (!isCurrent()) return;
            posted = outcomes.filter(row => row.result).length;
            message = `${posted} accounts corrected; ${outcomes.length - posted} submissions require a fresh review; ${blocked} blocked accounts unchanged.`;
            status().innerHTML = `<strong>${escaped(message)}</strong><ul>${outcomes.map(row => `<li>${escaped(row.reference)}: ${escaped(row.error || row.result.message)}${row.result ? ` Charges: ${money(row.result.summary.TotalDebit)}; outstanding: ${money(row.result.summary.OutstandingBalance)}; available credit: ${money(row.result.summary.CreditBalance)}.` : ' The response may have been lost after saving. Run a fresh review; do not resubmit this preview.'}</li>`).join('')}</ul>`;
          } catch (error) { message = `${error.message} Some corrections may already be saved. Run a fresh review.`; progress(message); }
          finally { post.disabled = true; post.textContent = 'Finished — run a fresh review before another submission';
            if (isCurrent()) { content.querySelector('h3').textContent = 'Textbook / yearbook correction results'; content.querySelector('[data-obsolete-reason]').readOnly = true; }
          }
          if (isCurrent()) await notify('Correction results', message, posted === eligible.length ? 'success' : 'error');
        });
      } catch (error) { progress(error.message); prepareButton.textContent = 'Review stopped — close and run a fresh review'; if (isCurrent()) await notify('Review not completed', error.message, 'error'); }
    });
  } catch (error) { progress(`${error.message} No posting controls are shown. Close and run a fresh review.`); if (isCurrent()) await notify('Review not completed', error.message, 'error'); }
}
