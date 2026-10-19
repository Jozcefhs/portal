import { createHash } from 'node:crypto';

const clean = (value) => String(value ?? '').trim();

export function r2BucketNameForProject(projectName) {
  const slug = clean(projectName).toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) throw new Error('A Cloudflare Pages project name is required.');
  const candidate = `${slug}-documents`;
  if (candidate.length <= 63) return candidate;
  const digest = createHash('sha256').update(slug).digest('hex').slice(0, 10);
  return `${slug.slice(0, 47).replace(/-+$/g, '')}-${digest}-docs`;
}

async function cloudflareJson(url, token, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const message = data?.errors?.map((item) => item.message).filter(Boolean).join('; ')
      || data?.error?.message
      || `Cloudflare API request failed (${response.status}).`;
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data.result ?? data;
}

export async function ensureCloudflareR2Storage({
  accountId,
  token,
  projectName,
  bucketName = '',
  binding = 'DYNAMAX_DOCUMENTS',
  fetchImpl = fetch
} = {}) {
  const account = clean(accountId);
  const apiToken = clean(token);
  const project = clean(projectName);
  const bucket = clean(bucketName) || r2BucketNameForProject(project);
  if (!account) throw new Error('CLOUDFLARE_ACCOUNT_ID is required.');
  if (!apiToken) throw new Error('CLOUDFLARE_API_TOKEN is required.');
  if (!project) throw new Error('A Cloudflare Pages project name is required.');
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error('The R2 bucket name must be 3-63 lowercase letters, numbers or internal hyphens.');
  }

  const accountBase = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}`;
  try {
    await cloudflareJson(`${accountBase}/r2/buckets/${encodeURIComponent(bucket)}`, apiToken, {}, fetchImpl);
  } catch (error) {
    if (Number(error.status) !== 404) throw error;
    await cloudflareJson(`${accountBase}/r2/buckets`, apiToken, {
      method: 'POST',
      body: JSON.stringify({ name: bucket })
    }, fetchImpl);
  }

  const projectUrl = `${accountBase}/pages/projects/${encodeURIComponent(project)}`;
  const pagesProject = await cloudflareJson(projectUrl, apiToken, {}, fetchImpl);
  const current = pagesProject.deployment_configs || {};
  // Pages project GET responses do not provide reusable encrypted secret values.
  // Resubmitting the full deployment configuration can therefore replace an
  // existing secret_text value with its masked/empty representation. PATCH only
  // the binding map; Cloudflare preserves every omitted setting and secret.
  const withBinding = (configuration = {}) => ({
    r2_buckets: {
      ...(configuration.r2_buckets || {}),
      [binding]: { name: bucket }
    }
  });
  await cloudflareJson(projectUrl, apiToken, {
    method: 'PATCH',
    body: JSON.stringify({
      deployment_configs: {
        preview: withBinding(current.preview),
        production: withBinding(current.production)
      }
    })
  }, fetchImpl);
  return { projectName: project, bucketName: bucket, binding };
}
