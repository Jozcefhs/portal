import { createDocumentIfAbsent, getDocument } from './firestore.js';
import { domainError } from './tenant-custom-domain.js';
import { tenantControlSecretHash } from './tenant-control-plane.js';

const api = 'https://api.cloudflare.com/client/v4';

async function cloudflare(env, path, { method = 'GET', body } = {}) {
  if (!env.DYNAMAX_ROOT_DNS_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
    throw domainError('Automatic DNS provisioning is unavailable. Your ownership record can stay in place while the platform connection is configured.', 503);
  }
  const form = body instanceof FormData;
  const response = await fetch(api + path, {
    method, redirect: 'manual', signal: AbortSignal.timeout(20000),
    headers: { Authorization: 'Bearer ' + env.DYNAMAX_ROOT_DNS_TOKEN, ...(!form && body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: form ? body : JSON.stringify(body) } : {})
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.success) {
    throw domainError('Cloudflare could not complete DNS setup. ' +
      (response.status === 403 ? 'The platform DNS connection needs Zone and DNS edit access.' :
        (data?.errors?.[0]?.message || 'Please check the status and try again.')), 502);
  }
  return data;
}

export async function ownershipRecord(project, registrationId, host) {
  const hash = await tenantControlSecretHash(JSON.stringify(['domain-proof-v1', project, registrationId, host]));
  return { type: 'TXT', name: '_dynamax-verify.' + host, value: 'dynamax-verification=' + hash };
}

async function publicDns(name, type) {
  const url = new URL('https://dns.google/resolve');
  url.search = new URLSearchParams({ name, type });
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
  const data = response.ok && await response.json();
  if (![0, 3].includes(data?.Status)) throw domainError('Public DNS could not be checked. Try again after your DNS update propagates.', 503);
  return (data.Answer || []).filter(row => row.name.toLowerCase().replace(/\.$/, '') === name);
}

export async function hasRootProof(proof) {
  const answers = await publicDns(proof.name, 'TXT');
  return answers.some(r => r.type === 16 && [proof.value, JSON.stringify(proof.value)].includes(r.data));
}

export async function provisionRoot(env, platform, host, project, owner) {
  const claims = 'customPortalRootClaims';
  let claim = await getDocument(platform, claims, host);
  if (claim && (claim.Owner !== owner || claim.Project !== project)) throw domainError('This domain is already assigned to another workspace.', 409);
  const zones = (await cloudflare(env, '/zones?' + new URLSearchParams({ name: host, 'account.id': env.CLOUDFLARE_ACCOUNT_ID }))).result;
  let zone = zones.find(z => z.name === host && z.account?.id === env.CLOUDFLARE_ACCOUNT_ID);
  if (!claim) {
    if (zone) throw domainError('This domain already has a Dynamax-managed DNS zone. Its existing assignment must be reconciled before it can move.', 409);
    claim = (await createDocumentIfAbsent(platform, claims, host, { Owner: owner, Project: project, StartedAt: new Date().toISOString() })).document;
  }
  if (claim?.Owner !== owner || claim?.Project !== project) throw domainError('This domain is reserved for another workspace.', 409);
  if (!zone) zone = (await cloudflare(env, '/zones', { method: 'POST', body: { name: host, account: { id: env.CLOUDFLARE_ACCOUNT_ID }, type: 'full' } })).result;
  if (zone.name !== host || zone.account?.id !== env.CLOUDFLARE_ACCOUNT_ID || zone.type !== 'full' ||
      !/^[a-f0-9]{32}$/.test(zone.id) || !Number.isFinite(Date.parse(zone.created_on)) ||
      !Number.isFinite(Date.parse(claim.StartedAt)) || Date.parse(zone.created_on) + 1000 < Date.parse(claim.StartedAt)) {
    throw domainError('Cloudflare returned a zone that does not match this workspace request.', 409);
  }
  return zone.id;
}

export async function reviewRootRecords(env, zoneId) {
  const records = [];
  let page = 1;
  while (true) {
    const data = await cloudflare(env, '/zones/' + zoneId + '/dns_records?per_page=100&page=' + page);
    records.push(...data.result.map(({ name, type, content, priority, data }) => ({ name, type, content, priority, data })));
    if (page >= (data.result_info?.total_pages || 1)) return records;
    page++;
  }
}

export async function importRootRecords(env, zoneId, source) {
  if (!source?.trim()) throw domainError('Choose a DNS zone file exported by your current provider.');
  const form = new FormData();
  form.set('file', new Blob([source], { type: 'text/plain' }), 'records.txt');
  form.set('proxied', 'false');
  await cloudflare(env, '/zones/' + zoneId + '/dns_records/import', { method: 'POST', body: form });
}

export async function prepareRootRecords(env, zoneId, host, project, pending) {
  if ((await publicDns(host, 'DS')).some(r => r.type === 43)) {
    throw domainError('Remove the existing DNSSEC DS at the registrar and wait for it to clear before moving nameservers.', 409);
  }
  const path = '/zones/' + zoneId + '/dns_records';
  const target = project + '.pages.dev';
  const { result: records, result_info: info } = await cloudflare(env, path + '?' + new URLSearchParams({ 'name.exact': host, per_page: '100' }));
  if (info?.total_pages > 1) throw domainError('The root has too many DNS records to prepare in one operation.', 409);
  const routes = records.filter(r => r.name === host && ['A','AAAA','CNAME'].includes(r.type));
  const ready = routes.find(r => r.type === 'CNAME' && r.content.replace(/\.$/, '') === target && r.proxied === true);
  if (ready && routes.length === 1) return;
  if (!pending) throw domainError('The DNS zone is already active. Its live website records cannot be replaced during preparation.', 409);
  // Only the new zone's staged website records may be replaced. Batch changes atomically.
  await cloudflare(env, path + '/batch', { method: 'POST', body: {
    deletes: routes.filter(r => r !== ready).map(r => ({ id: r.id })),
    posts: ready ? [] : [{ type: 'CNAME', name: host, content: target, ttl: 1, proxied: true }]
  } });
}
