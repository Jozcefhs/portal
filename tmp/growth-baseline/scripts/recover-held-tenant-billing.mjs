import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyOrganisationDeployment } from './verify-organisation-deployment.mjs';

export const BILLING_ACCOUNT = '01DFE6-C94543-13DEC6';
export const TARGETS = Object.freeze([
  ['dynamax-tenant-002', 'school', true],
  ['dynamax-tenant-003', 'faith', true],
  ['dynamax-tenant-004', 'faith', true],
  ['dynamax-tenant-007', 'organization', true],
  ['dynamax-tenant-009', 'organization', true],
  ['dynamax-tenant-010', 'organization', false],
  ['dynamax-tenant-sch-f432840944', 'school', false]
]);
const HOLD_REASON = 'Billing disabled; hold until Blaze billing is verified';

export function validateHeldSlot(inventory, project, edition) {
  const matches = (inventory.slots || []).filter((slot) => slot.FirebaseProjectId === project);
  if (matches.length !== 1) throw new Error(`${project}: expected exactly one existing pool slot.`);
  const slot = matches[0];
  if (slot.Status !== 'Maintenance' || slot.AssignedRegistrationReference || slot.AssignedOrganisationName) {
    throw new Error(`${project}: not an unassigned Maintenance slot; refusing to modify it.`);
  }
  if (slot.MaintenanceReason !== HOLD_REASON || slot.Edition !== edition
      || slot.CloudflareProject !== project || slot.WorkspaceId !== project
      || slot.PortalUrl !== `https://${project}.pages.dev` || slot.Id !== project) {
    throw new Error(`${project}: hold reason or deployment identity changed; manual review required.`);
  }
  return slot;
}

export function verifiedBilling(info, status, project, consoleVerifiedLegacy) {
  const legacy = TARGETS.find(([id]) => id === project)?.[2] === true;
  // The existing service identity cannot view the older personal-account projects.
  // Only these five exact projects may use an explicit, current console attestation.
  if (status === 403 && legacy && consoleVerifiedLegacy) return 'Google console verification';
  if (status !== 200) throw new Error(`${project}: billing verification returned HTTP ${status}.`);
  if (info?.billingEnabled !== true || info?.billingAccountName !== `billingAccounts/${BILLING_ACCOUNT}`) {
    throw new Error(`${project}: active billing on the approved account is not verified.`);
  }
  return 'Google billing API verification';
}

export async function recoverHeldTenants({ apply = false, consoleVerifiedLegacy = false, load, billing, link, verify, register }) {
  const initial = await load();
  const prepared = [];
  // Validate every target before any billable or pool mutation.
  for (const [project, edition, legacy] of TARGETS) {
    const slot = validateHeldSlot(initial, project, edition);
    const result = await billing(project);
    if (result.status === 200 && result.info?.billingEnabled === false) {
      if (legacy) throw new Error(`${project}: console attestation conflicts with live unbilled status.`);
      if (result.info.billingAccountName && result.info.billingAccountName !== `billingAccounts/${BILLING_ACCOUNT}`) {
        throw new Error(`${project}: attached to another account; refusing to replace it.`);
      }
      prepared.push({ project, edition, slot, needsLink: true, evidence: 'Billing link required' });
    } else {
      prepared.push({ project, edition, slot, needsLink: false,
        evidence: verifiedBilling(result.info, result.status, project, consoleVerifiedLegacy) });
    }
    await verify({ url: slot.PortalUrl, workspaceId: project, edition, attempts: 1 });
  }
  if (!apply) return prepared.map(({ project, needsLink, evidence }) => ({ project, needsLink, evidence, status: 'Dry run — held' }));

  // Link and verify both newer projects before releasing any hold.
  for (const item of prepared.filter((item) => item.needsLink)) {
    await link(item.project, BILLING_ACCOUNT);
    const result = await billing(item.project);
    item.evidence = verifiedBilling(result.info, result.status, item.project, false);
  }
  const results = [];
  for (const item of prepared) {
    // Re-read immediately before register; the API also refuses Reserved/Assigned slots.
    const slot = validateHeldSlot(await load(), item.project, item.edition);
    const result = await register({ ...slot, Status: 'Ready', LastError: '',
      BillingAccountId: BILLING_ACCOUNT, BillingVerifiedAt: new Date().toISOString() });
    if (!['Ready', 'Assigned'].includes(result?.slot?.Status)) throw new Error(`${item.project}: hold release was not confirmed.`);
    results.push({ project: item.project, evidence: item.evidence, status: result.slot.Status });
  }
  const final = await load();
  for (const result of results) {
    const slot = final.slots.find((item) => item.FirebaseProjectId === result.project);
    if (!slot || !['Ready', 'Assigned'].includes(slot.Status) || slot.BillingAccountId !== BILLING_ACCOUNT
        || !slot.BillingVerifiedAt || slot.MaintenanceReason) throw new Error(`${result.project}: final pool verification failed.`);
    result.status = slot.Status;
  }
  for (const oldSlot of initial.slots.filter((slot) => slot.Status === 'Assigned')) {
    const current = final.slots.find((slot) => slot.Id === oldSlot.Id);
    if (!current || current.Status !== oldSlot.Status
        || current.AssignedRegistrationReference !== oldSlot.AssignedRegistrationReference
        || current.BillingAccountId !== oldSlot.BillingAccountId) throw new Error('An originally Assigned slot changed; review required.');
  }
  return results;
}

async function main() {
  if (process.env.DYNAMAX_GCP_BILLING_ACCOUNT !== BILLING_ACCOUNT) throw new Error('Configured billing account differs from the user-approved account.');
  const base = new URL(process.env.DYNAMAX_PLATFORM_URL || 'https://dynamax.cc');
  if (base.origin !== 'https://dynamax.cc') throw new Error('Only the existing Dynamax platform is approved for this recovery.');
  const password = process.env.DYNAMAX_TENANT_PROVISIONER_SECRET;
  if (!password) throw new Error('Existing pool access secret is missing.');
  const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
  const pool = async (payload) => {
    const response = await fetch(new URL('/api/tenant-project-pool', base), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, password }), signal: AbortSignal.timeout(60000)
    });
    const data = await response.json();
    if (!response.ok || data.ok !== true) throw new Error(`Pool operation ${payload.action} failed (HTTP ${response.status}).`);
    return data;
  };
  const billingRequest = async (project, method = 'GET', account) => {
    const response = await fetch(`https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(method === 'PUT' ? { body: JSON.stringify({ billingAccountName: `billingAccounts/${account}` }) } : {}),
      signal: AbortSignal.timeout(30000)
    });
    const info = await response.json();
    if (method === 'PUT' && !response.ok) throw new Error(`${project}: billing link failed (HTTP ${response.status}).`);
    return { status: response.status, info };
  };
  const results = await recoverHeldTenants({
    apply: process.env.RECOVERY_APPLY === 'true',
    consoleVerifiedLegacy: process.env.CONSOLE_VERIFIED_LEGACY === 'true',
    load: () => pool({ action: 'load' }), billing: billingRequest,
    link: (project, account) => billingRequest(project, 'PUT', account),
    verify: verifyOrganisationDeployment, register: (slot) => pool({ action: 'register', slot })
  });
  const summary = ['### Approved tenant billing recovery', '',
    `Billing account: ${BILLING_ACCOUNT}. No IAM changes, credential replacement, deployment or data deletion.`, '',
    '| Project | Evidence | Result |', '| --- | --- | --- |',
    ...results.map((row) => `| ${row.project} | ${row.evidence} | ${row.status} |`), '',
    'Originally Assigned projects were not modified.'].join('\n');
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
