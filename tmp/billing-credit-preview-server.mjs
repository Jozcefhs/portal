import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { studentBillingReconciliationPlan } from '../functions/api/backend.js';
import { parentCreditReview } from '../functions/lib/student-billing-diagnostics.js';
import { student, billingFixture, renderBillingReport, renderParentCredit } from '../tests/helpers/billing-credit-review.mjs';
const plan = await studentBillingReconciliationPlan(student, billingFixture());
const rows = Array.from({ length: 6 }, (_, index) => ({ ...plan, profile: { ...plan.profile,
  DisplayName: `Sample student ${index + 1}`, AccountRef: `TEST/26/00${index + 1}` } }));
const report = await renderBillingReport({ total: 1135, matched: 435, incomplete: 689, ready: 0,
  missingAccounts: 6, blockedMissingAccounts: 6, review: 11, rows });
const credit = await renderParentCredit({ TotalDebit: 1008850, TotalCredit: 1502885, OutstandingBalance: 0,
  CreditBalance: 494035, BillingReview: parentCreditReview(plan) });
const head = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Billing review QA — sample data only</title><link rel="stylesheet" href="/css/style.css"></head>';
const admin = `${head}<body class="staff-page"><dialog id="studentBillingPreviewDialog" class="workflow-dialog student-profile-dialog"><div class="workflow-dialog-header"><div><small>Read-only finance review</small><h2>Student billing reconciliation preview</h2></div><button type="button" aria-label="Close billing preview" onclick="document.querySelector('dialog').close()">×</button></div><div class="config-group" data-billing-preview-content>${report}</div></dialog><script>document.querySelector('dialog').showModal()</script></body></html>`;
const parent = `${head}<body><main class="container"><section class="card"><h2>Payments — sample student</h2><div class="metric-row" id="accountCreditSummary">${credit}</div></section></main></body></html>`;
const mobile = `${head}<body><h2>390px mobile preview — sample data</h2><iframe title="Parent mobile preview" src="/parent" style="width:390px;height:740px;border:1px solid #777"></iframe></body></html>`;
const assets = new Map([['/admin', admin], ['/parent', parent], ['/mobile', mobile], ['/css/style.css', await readFile(new URL('../css/style.css', import.meta.url))]]);
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  response.writeHead(assets.has(path) ? 200 : 404, { 'Content-Type': path.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(path === '/css/style.css' ? await readFile(new URL('../css/style.css', import.meta.url)) : assets.get(path) || 'Not found');
});
server.listen(0, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}/admin`));
