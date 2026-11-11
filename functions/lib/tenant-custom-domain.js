import { parse } from 'tldts';

export const domainError = (message, status = 400) => Object.assign(new Error(message), { status });
const hostnamePattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const reserved = ['pages.dev', 'workers.dev', 'dynamax.cc'];

export function customPortalHostname(value, kind = 'subdomain') {
  const host = String(value ?? '').trim().toLowerCase().replace(/\.$/, '');
  const { isIcann, isPrivate, subdomain, domain } = parse(host, { allowPrivateDomains: true });
  if (host.length > 253 || !hostnamePattern.test(host) || !isIcann || isPrivate || !domain
      || !['root', 'subdomain', 'either'].includes(kind)
      || (kind === 'root' && host !== domain) || (kind === 'subdomain' && !subdomain)
      || reserved.some(domain => host === domain || host.endsWith('.' + domain))) {
    throw domainError(kind === 'root' ? 'Enter a root domain you own, such as sampleacademy.com.'
      : 'Enter a subdomain you own, such as portal.sampleacademy.com.');
  }
  return host;
}

export function paymentReferenceId(value) {
  const reference = String(value ?? '').trim();
  if (!/^[A-Za-z0-9._=-]{1,140}$/.test(reference)) throw domainError('Enter the reference from a completed checkout on this address.');
  return reference;
}

export async function pagesDomain(env, project, host, { attach = false, fetcher = fetch } = {}) {
  if (!/^[a-z0-9][a-z0-9-]{1,57}[a-z0-9]$/.test(project)) throw domainError('The assigned Pages project is invalid.', 409);
  const account = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const token = String(env.CLOUDFLARE_PAGES_API_TOKEN || '').trim();
  if (!account || !token) throw domainError('Custom domain setup is temporarily unavailable.', 503);
  const domains = 'https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent(account)
    + '/pages/projects/' + project + '/domains';
  const request = async (method, url, body) => {
    const response = await fetcher(url, {
      method, redirect: 'error', signal: AbortSignal.timeout(12000),
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json().catch(() => null);
    return { response, data };
  };
  const url = domains + '/' + encodeURIComponent(host);
  let result = await request('GET', url);
  if (attach && result.response.status === 404) {
    result = await request('POST', domains, { name: host });
    // A simultaneous setup request may have attached this exact hostname.
    if (!result.response.ok && result.response.status < 500) result = await request('GET', url);
  }
  if (result.response.status === 404 && !attach) return null;
  if (!result.response.ok || result.data?.success !== true || result.data.result?.name !== host) {
    throw domainError('Cloudflare could not confirm this domain on your project. Check that it is available and try again.', 502);
  }
  return result.data.result;
}

export async function readRootPortalZone(env, hostname, zoneId, fetcher = fetch) {
  const host = customPortalHostname(hostname, 'root');
  const account = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const token = String(env.CLOUDFLARE_ZONE_READ_API_TOKEN || env.CLOUDFLARE_PAGES_API_TOKEN || '').trim();
  if (!account || !token) throw domainError('Cloudflare zone verification is unavailable.', 503);
  if (!/^[a-f0-9]{32}$/i.test(zoneId || '')) throw domainError('Enter the Cloudflare zone ID.');
  const response = await fetcher('https://api.cloudflare.com/client/v4/zones/' + zoneId, {
    redirect: 'error', signal: AbortSignal.timeout(12000), headers: { Authorization: 'Bearer ' + token }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.success !== true) throw domainError('Cloudflare could not read the approved DNS zone. Check the zone and Zone Read access.', 502);
  const zone = data.result;
  if (zone?.id !== zoneId || zone.name !== host || zone.account?.id !== account || zone.type !== 'full') {
    throw domainError('The approved zone must match this root domain and belong to the Pages account.', 409);
  }
  return { status: zone.status, nameservers: (Array.isArray(zone.name_servers) ? zone.name_servers : [])
    .filter(name => typeof name === 'string' && hostnamePattern.test(name)) };
}

export function domainSetupState(registration, provider, zone = null) {
  const hostname = registration.CustomPortalHostname || '';
  const target = registration.CloudflareProject + '.pages.dev';
  const domainKind = registration.CustomPortalDomainKind || 'subdomain';
  const root = domainKind === 'root';
  const status = root && !zone ? 'awaiting-zone'
    : root && zone.status !== 'active' ? 'awaiting-nameservers'
      : provider?.status || (hostname ? 'not-attached' : 'not-configured');
  return {
    hostname, domainKind, status,
    ...(root ? { nameservers: zone?.nameservers || [], zoneStatus: zone?.status || '',
      registrationReference: registration.Reference || registration.__id || '' } : {}),
    primaryUrl: registration.PrimaryPortalUrl || registration.PortalUrl,
    defaultUrl: registration.PortalUrl, paymentRequired: registration.PaystackConnected === true,
    dns: hostname && (!root || zone?.status === 'active') ? { type: 'CNAME', name: hostname, target } : null,
    certificateRecord: provider?.validation_data?.method === 'txt' && provider.validation_data.txt_name
      && provider.validation_data.txt_value ? {
        type: 'TXT', name: provider.validation_data.txt_name, target: provider.validation_data.txt_value
      } : null
  };
}
