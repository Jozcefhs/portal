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

function feeBreakdown(plan) {
  if (!Array.isArray(plan.expectedComponents) || !plan.expectedComponents.length) return '';
  return `<details><summary>View ${plan.expectedComponents.length} fee components</summary><p>Combined total for ${escaped(plan.profile?.BillingCategory || 'the saved billing category')}. This is not a single fee item or the outstanding balance.</p><ul>${plan.expectedComponents.map(row => `<li>${escaped(row.name)} (${escaped(row.code)}): ${money(row.amount)}</li>`).join('')}</ul></details>`;
}

export function obsoleteChargeTable(plans, verified = false) {
  return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Student / period</th><th>Charges to reverse</th><th>Bill before → after</th><th>Existing allocation released</th><th>Review</th></tr></thead><tbody>${plans.map(plan =>
    `<tr><td>${escaped(plan.profile?.DisplayName || '')}<br>${escaped(ref(plan))}<br>${escaped(plan.profile?.ClassName || '')} · ${escaped(plan.profile?.SchoolSection || '')}<br>${escaped(plan.profile?.AcademicSession || '')} · ${escaped(plan.profile?.Term || '')}</td>
    <td>${(plan.charges || []).map(charge => `${escaped(charge.name)} (${escaped(charge.code)}): ${money(charge.amount)}<br><small>${escaped(charge.invoiceId)}<br>${escaped(charge.reason || charge.explanation || '')}</small>`).join('<br>') || 'Not verified'}</td>
    <td>${plan.postedTotal == null ? 'Not verified' : `${money(plan.postedTotal)} → ${money(plan.afterPostedTotal)}<br><small>${plan.expectedTotal == null ? 'Full fee comparison awaits profile completion.' : `Total of applicable fee components: ${money(plan.expectedTotal)}`}</small>${feeBreakdown(plan)}`}</td>
    <td>${plan.releasedCredit == null ? 'Not verified' : money(plan.releasedCredit)}</td>
    <td>${escaped(verified && reviewedBoardingWearPlan(plan) ? 'Verified — eligible for approval' : plan.reason || 'Candidate — receipt and journal checks required')}${plan.eligibilityNote ? `<br><small>${escaped(plan.eligibilityNote)}</small>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
}

export async function openObsoleteChargeReview({ dialog, content, request, isCurrent, confirm, notify, readOnly = false, accountRef = '', loadedAccounts = null, onResults = () => {} }) {
  const subtitle = dialog.querySelector('.workflow-dialog-header small');
  if (subtitle) {
    const original = subtitle.textContent;
    subtitle.textContent = 'Reviewed finance correction';
    dialog.addEventListener('close', () => { subtitle.textContent = original; }, { once: true });
  }
  if (loadedAccounts !== null) return openLoadedBillingConflictReview({ content, request, isCurrent, confirm, notify, readOnly, loadedAccounts, onResults });
  if (accountRef) return openStudentBillingConflictReview({ dialog, content, request, isCurrent, confirm, notify, readOnly, accountRef, onResults });
  content.innerHTML = '<h3>Review incorrect school fee charges</h3><p>Checking every class in the permitted branch and school sections. This review does not change financial records.</p><p role="status" aria-live="polite" data-obsolete-status></p>';
  if (!dialog.open) dialog.showModal();
  const status = () => content.querySelector('[data-obsolete-status]');
  const progress = text => { if (isCurrent() && status()) status().textContent = text; };
  try {
    const report = await reviewObsoleteChargeAccounts(request, (checked, total) => progress(`Checked ${checked} of ${total} profiles…`));
    if (!isCurrent()) return;
    content.innerHTML = `<h3>Incorrect school fee charge review</h3><p>${report.total} profiles checked; ${report.rows.length} accounts flagged; ${report.matched} have no obsolete charges identified. Changed or ambiguous profiles stay flagged for rechecking.</p>
      <p>Wrong-gender uniform charges can qualify when the saved gender and fee rule prove the mismatch. Textbook/yearbook charges can qualify when a saved fee rule proves they belong to a different class, or to returning students instead of New Intake. Review the student's saved class and classifications before approving a correction. Valid fees, payments and receipts are preserved.</p>
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
        content.innerHTML = `<h3>School fee correction — ready for approval</h3><p>${eligible.length} accounts ready; ${blocked} require further review.</p>
          <p><strong>Charges to reverse: ${money(amount)}. Existing allocations released: ${money(released)}.</strong></p>
          <p>Each account is revalidated and committed atomically. Original invoice amounts, payments and receipts stay intact. Released uniform allocations move to verified correct uniform invoices where available; remaining credit stays on the account. No new payment, refund or wallet credit is created.</p>
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
            if (isCurrent()) { content.querySelector('h3').textContent = 'School fee correction results'; content.querySelector('[data-obsolete-reason]').readOnly = true; }
          }
          if (isCurrent()) await notify('Correction results', message, posted === eligible.length ? 'success' : 'error');
        });
      } catch (error) { progress(error.message); prepareButton.textContent = 'Review stopped — close and run a fresh review'; if (isCurrent()) await notify('Review not completed', error.message, 'error'); }
    });
  } catch (error) { progress(`${error.message} No posting controls are shown. Close and run a fresh review.`); if (isCurrent()) await notify('Review not completed', error.message, 'error'); }
}

// Open directly from a conflicting billing row. Only this account's evidence is
// requested, and no posting happens until its exact preview is approved.
export async function openStudentBillingConflictReview({ dialog, content, request, isCurrent, confirm, notify, readOnly = false, accountRef, onResults = () => {} }) {
  content.innerHTML = '<h3>Resolve billing conflicts</h3><p>Checking this account’s invoices, fee rules and payment evidence…</p><p role="status" data-conflict-status></p>';
  if (!dialog.open) dialog.showModal();
  let previousReview = '', rechecking = false;
  const render = async (recheck = false) => {
    const plan = await request({ action: 'previewObsoleteReversal', AccountRef: accountRef });
    if (!isCurrent()) return;
    if (ref(plan).toLowerCase() !== String(accountRef).trim().toLowerCase()) throw new Error('The preview belongs to a different account. Close and review again.');
    const eligible = reviewedBoardingWearPlan(plan);
    const remaining = (plan.conflicts || []).filter(row => !eligible || !(plan.charges || []).some(charge => charge.code.toLowerCase() === row.code.toLowerCase()));
    const snapshot = JSON.stringify([plan.profile, plan.ready, plan.reason, plan.charges, plan.conflicts,
      plan.expectedTotal, plan.postedTotal, plan.afterPostedTotal, plan.releasedCredit, plan.expectedComponents, plan.reallocations]);
    const unchanged = previousReview === snapshot;
    previousReview = snapshot;
    content.innerHTML = `<h3>Resolve billing conflicts</h3>
      <p><strong>${escaped(plan.profile.DisplayName)}</strong> · ${escaped(accountRef)} · ${escaped(plan.profile.ClassName)}</p>
      <p>${escaped(plan.profile.AcademicSession)} · ${escaped(plan.profile.Term)}</p>
      <p>A conflict means a posted invoice disagrees with the current fee setup. It can follow a class/profile change, a changed fee rule or an incorrect original charge. This comparison alone cannot identify which change caused it.</p>
      <p>First confirm that the saved class and classifications are correct. If they are wrong, close this review, correct the student profile and preview billing again. If the fee rule is wrong, correct it in fee settings. If the charge itself is wrong, review the correction below.</p>
      ${plan.charges?.length || remaining.length ? obsoleteChargeTable([plan], true) : ''}
      ${eligible ? `<p><strong>Proposed reversal: ${money(plan.amount)}. Outstanding removed: ${money(plan.outstandingRemoved)}. Existing allocation released: ${money(plan.releasedCredit)}.</strong> Original invoices, payments and receipts remain in the audit trail. This creates no new payment or refund.</p>` : `<p role="status"><strong>${escaped(Array.isArray(plan.conflicts) && !plan.conflicts.length ? 'No conflicting posted charges remain for this period.' : plan.reason || 'No verified charge reversal is available.')}</strong> No charges can be changed from this preview. Use the billing preview to check any missing charges.</p>`}
      ${(plan.reallocations || []).length ? `<p><strong>Existing payment allocation to move:</strong></p><ul>${plan.reallocations.map(row => `<li>${escaped(row.name)}: ${money(row.amount)}</li>`).join('')}</ul><p>This uses existing paid money; it does not record a new payment.</p>` : ''}
      ${remaining.length ? `<details open><summary>${remaining.length} other or unresolved component(s)</summary><ul>${remaining.map(row => `<li>${escaped(row.name || row.code)} (${escaped(row.code)}): ${escaped(row.review)}. Current setup ${money(row.expected)}; posted ${money(row.invoiced)}. Invoice(s): ${(row.invoiceIds || []).map(escaped).join(', ')}.</li>`).join('')}</ul><p>Duplicate invoice references, changed amounts or missing payment evidence need a source-record correction; they cannot safely be cleared by this reversal.</p></details>` : ''}
      ${eligible && !readOnly ? '<label>Correction reason<textarea data-conflict-reason maxlength="500" required></textarea></label><button type="button" data-post-conflict>Approve this charge correction</button>' : ''}
      <button type="button" class="secondary" data-recheck-conflict>Recheck this account</button><p role="status" aria-live="polite" tabindex="-1" data-conflict-status></p>`;
    if (recheck) {
      const status = content.querySelector('[data-conflict-status]');
      const outcome = eligible ? 'A verified correction is available for review and approval.'
        : Array.isArray(plan.conflicts) && !plan.conflicts.length ? 'No conflicting posted charges remain for this period.'
          : `This account still needs finance review: ${plan.reason || 'The listed conflicts need a source-record correction.'}`;
      status.textContent = `Rechecked at ${new Date().toLocaleTimeString()}. ${unchanged ? 'No changes found.' : 'The review has been updated.'} ${outcome} Rechecking only refreshes the evidence; it does not change invoices, fees or payments.`;
      status.focus({ preventScroll: true });
      status.scrollIntoView({ block: 'nearest' });
    }
    content.querySelector('[data-recheck-conflict]').addEventListener('click', async event => {
      if (rechecking || !isCurrent()) return;
      const button = event.currentTarget;
      rechecking = true;
      button.disabled = true; button.textContent = 'Rechecking this account…'; button.setAttribute('aria-busy', 'true');
      content.querySelector('[data-conflict-status]').textContent = 'Checking this account’s latest invoices, fee rules and payment evidence…';
      content.querySelector('[data-post-conflict]')?.setAttribute('disabled', '');
      try { await render(true); }
      catch (error) { if (isCurrent()) content.querySelector('[data-conflict-status]').textContent = `Recheck failed: ${error.message} The previous preview has not been refreshed. Try Recheck this account again before approving any correction.`; }
      finally {
        rechecking = false;
        if (isCurrent() && button.isConnected) { button.disabled = false; button.textContent = 'Recheck this account'; button.removeAttribute('aria-busy'); }
      }
    });
    content.querySelector('[data-post-conflict]')?.addEventListener('click', async event => {
      const button = event.currentTarget, reason = content.querySelector('[data-conflict-reason]').value.trim();
      if (button.disabled || !isCurrent()) return;
      if (!reason) { await notify('Correction reason required', 'Enter why this posted charge should be reversed.', 'error'); return; }
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      const recheck = content.querySelector('[data-recheck-conflict]'); recheck.disabled = true;
      if (!await confirm({ title: 'Approve this charge correction', message: `Reverse ${money(plan.amount)} for ${plan.profile.DisplayName || accountRef} (${accountRef})? Confirm that the saved class is correct and these charges should not apply. Original payments and receipts are preserved.`, confirmText: 'Approve correction' })) {
        if (isCurrent()) { button.disabled = false; button.removeAttribute('aria-busy'); recheck.disabled = false; } return;
      }
      if (!isCurrent()) return;
      button.textContent = 'Posting reviewed correction…';
      const status = content.querySelector('[data-conflict-status]');
      try {
        const [outcome] = await postObsoleteCharges([plan], reason, request);
        if (!isCurrent()) return;
        onResults([{ ...outcome, plan }]);
        if (!outcome.result) throw new Error(outcome.error);
        status.textContent = `${outcome.result.message} Recheck this account to see the updated billing review.`;
        button.textContent = 'Correction posted';
        await notify('Charge correction posted', status.textContent, 'success');
      } catch (error) {
        if (isCurrent()) { status.textContent = `${error.message} Recheck this account before another approval; this preview will not be submitted again.`; button.textContent = 'Recheck required'; }
      } finally {
        button.disabled = true;
        button.removeAttribute('aria-busy');
        if (isCurrent()) { recheck.disabled = false; content.querySelector('[data-conflict-reason]').readOnly = true; }
      }
    });
  };
  try { await render(); }
  catch (error) { if (isCurrent()) { content.querySelector('[data-conflict-status]').textContent = error.message; await notify('Review not completed', error.message, 'error'); } }
}

export async function openLoadedBillingConflictReview({ content, request, isCurrent, confirm, notify, readOnly, loadedAccounts, onResults = () => {} }) {
  const accounts = [...new Map(loadedAccounts.map(value => String(value || '').trim()).filter(Boolean).map(value => [value.toLowerCase(), value])).values()];
  content.innerHTML = '<h3>Batch review of loaded conflicts</h3><p>Checking only the accounts already listed in this review. No charges are changed during this check.</p><p role="status" data-batch-status aria-busy="true"></p>';
  const progress = message => { const status = content.querySelector('[data-batch-status]'); if (isCurrent() && status) status.textContent = message; };
  const plans = await prepareObsoleteCharges(accounts.map(AccountRef => ({ profile: { AccountRef } })), request,
    (index, total, reference) => progress(`Checking ${index} of ${total}: ${reference}…`));
  if (!isCurrent()) return;
  const eligible = plans.filter(reviewedBoardingWearPlan), blocked = plans.length - eligible.length;
  content.innerHTML = `<h3>Batch review of loaded conflicts</h3><p><strong>${eligible.length} accounts ready; ${blocked} require further review.</strong> Select the corrections to approve. Other accounts stay unchanged.</p>
    ${obsoleteChargeTable(plans, true)}
    ${eligible.length ? `<fieldset><legend>Verified accounts to correct</legend>${eligible.map((plan, index) => `<label class="row-check"><input type="checkbox" data-batch-account="${index}" checked${readOnly ? ' disabled' : ''}> ${escaped(plan.profile.DisplayName || ref(plan))} · ${escaped(ref(plan))} · ${money(plan.amount)}</label>`).join('')}</fieldset>` : ''}
    ${eligible.length && !readOnly ? '<label>Approval reason<textarea data-batch-reason maxlength="500" required></textarea></label><button type="button" data-batch-post>Approve selected corrections</button>' : ''}
    <p role="status" aria-live="polite" data-batch-status></p>`;
  content.querySelector('[data-batch-post]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    if (button.disabled || !isCurrent() || readOnly) return;
    const reason = content.querySelector('[data-batch-reason]').value.trim();
    const selected = [...content.querySelectorAll('[data-batch-account]:checked')].map(box => eligible[Number(box.dataset.batchAccount)]);
    if (!reason || !selected.length) { await notify('Selection and reason required', 'Select at least one verified account and enter an approval reason.', 'error'); return; }
    button.disabled = true; button.setAttribute('aria-busy', 'true');
    if (!await confirm({ title: 'Approve selected charge corrections', message: `Reverse ${money(selected.reduce((sum, plan) => sum + plan.amount, 0))} across ${selected.length} account(s)? Existing payments and receipts are preserved. Each account is rechecked before posting.`, confirmText: 'Approve selected' })) {
      if (isCurrent()) { button.disabled = false; button.removeAttribute('aria-busy'); } return;
    }
    if (!isCurrent()) return;
    content.querySelectorAll('[data-batch-account]').forEach(box => { box.disabled = true; });
    content.querySelector('[data-batch-reason]').readOnly = true;
    button.textContent = 'Posting selected corrections…';
    try {
      const outcomes = await postObsoleteCharges(selected, reason, request,
        (index, total, reference) => progress(`Posting ${index} of ${total}: ${reference}…`));
      if (!isCurrent()) return;
      const enriched = outcomes.map(outcome => ({ ...outcome, plan: selected.find(plan => ref(plan) === outcome.reference) }));
      onResults(enriched);
      const posted = outcomes.filter(row => row.result).length;
      content.querySelector('[data-batch-status]').innerHTML = `<strong>${posted} corrected; ${outcomes.length - posted} need rechecking; ${plans.length - selected.length} left unchanged.</strong><ul>${outcomes.map(row => `<li>${escaped(row.reference)}: ${escaped(row.error || row.result.message)}</li>`).join('')}</ul><p>Use Back to loaded review to continue. Unconfirmed submissions are never retried automatically.</p>`;
      button.textContent = 'Finished — back to loaded review';
    } catch (error) { progress(`${error.message} Recheck affected accounts before another submission.`); }
    finally { button.disabled = true; button.removeAttribute('aria-busy'); }
  });
}
