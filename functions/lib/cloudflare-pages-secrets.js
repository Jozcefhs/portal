const clean = (value) => String(value ?? '').trim();

function cloudflareConfiguration(env = {}) {
  const accountId = clean(env.CLOUDFLARE_ACCOUNT_ID);
  const apiToken = clean(env.CLOUDFLARE_PAGES_API_TOKEN);
  if (!accountId || !apiToken) {
    const error = new Error('Secure payment onboarding is temporarily unavailable. The platform Cloudflare control plane is not configured.');
    error.status = 503;
    error.code = 'CLOUDFLARE_CONTROL_PLANE_NOT_CONFIGURED';
    throw error;
  }
  return { accountId, apiToken };
}

function projectName(value) {
  const name = clean(value).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,57}[a-z0-9]$/.test(name)) {
    const error = new Error('The assigned Cloudflare project is invalid.');
    error.status = 409;
    error.code = 'TENANT_CLOUDFLARE_PROJECT_INVALID';
    throw error;
  }
  return name;
}

async function cloudflareRequest(url, options, fetchImpl) {
  const response = await fetchImpl(url, options);
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.success === false) {
    const error = new Error('Cloudflare could not apply the encrypted payment credential. Try again or contact Dynamax support.');
    error.status = response.status >= 400 && response.status < 500 ? 503 : (response.status || 503);
    error.code = 'CLOUDFLARE_SECRET_UPDATE_FAILED';
    throw error;
  }
  return data;
}

function cloudflareHeaders(apiToken) {
  return {
    Authorization: `Bearer ${apiToken}`,
    'Content-Type': 'application/json'
  };
}

export async function setPagesProductionSecret(env, project, name, value, fetchImpl = fetch) {
  const { accountId, apiToken } = cloudflareConfiguration(env);
  const targetProject = projectName(project);
  const variableName = clean(name);
  if (!/^[A-Z][A-Z0-9_]{1,79}$/.test(variableName) || !clean(value)) {
    const error = new Error('The encrypted deployment variable is invalid.');
    error.status = 400;
    throw error;
  }
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(targetProject)}`;
  await cloudflareRequest(endpoint, {
    method: 'PATCH',
    headers: cloudflareHeaders(apiToken),
    body: JSON.stringify({
      deployment_configs: {
        production: {
          env_vars: {
            [variableName]: { type: 'secret_text', value: clean(value) }
          }
        }
      }
    })
  }, fetchImpl);
  return { project: targetProject, variable: variableName };
}

export async function retryLatestPagesProductionDeployment(env, project, fetchImpl = fetch) {
  const { accountId, apiToken } = cloudflareConfiguration(env);
  const targetProject = projectName(project);
  const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(targetProject)}/deployments`;
  const listed = await cloudflareRequest(`${base}?env=production&page=1&per_page=5`, {
    headers: cloudflareHeaders(apiToken)
  }, fetchImpl);
  const deployment = (Array.isArray(listed?.result) ? listed.result : [])
    .find((item) => clean(item?.id) && item?.is_skipped !== true);
  if (!deployment) return { queued: false, deploymentId: '' };
  const retried = await cloudflareRequest(`${base}/${encodeURIComponent(deployment.id)}/retry`, {
    method: 'POST',
    headers: cloudflareHeaders(apiToken),
    body: '{}'
  }, fetchImpl);
  return { queued: true, deploymentId: clean(retried?.result?.id || deployment.id) };
}
