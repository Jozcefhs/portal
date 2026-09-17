const clean = (value) => String(value ?? '').trim();

function definitivePatchError(error) {
  error.patchOutcomeUncertain = false;
  return error;
}

function cloudflareConfiguration(env = {}) {
  const accountId = clean(env.CLOUDFLARE_ACCOUNT_ID);
  const apiToken = clean(env.CLOUDFLARE_PAGES_API_TOKEN);
  if (!accountId || !apiToken) {
    const error = new Error('Secure tenant configuration is temporarily unavailable. The platform Cloudflare control plane is not configured.');
    error.status = 503;
    error.code = 'CLOUDFLARE_CONTROL_PLANE_NOT_CONFIGURED';
    throw definitivePatchError(error);
  }
  return { accountId, apiToken };
}

function projectName(value) {
  const name = clean(value).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,57}[a-z0-9]$/.test(name)) {
    const error = new Error('The assigned Cloudflare project is invalid.');
    error.status = 409;
    error.code = 'TENANT_CLOUDFLARE_PROJECT_INVALID';
    throw definitivePatchError(error);
  }
  return name;
}

async function cloudflareRequest(url, options, fetchImpl) {
  const response = await fetchImpl(url, options);
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.success === false) {
    const error = new Error('Cloudflare could not apply the encrypted tenant credential. Try again or contact Dynamax support.');
    error.status = response.status >= 400 && response.status < 500 ? 503 : (response.status || 503);
    error.code = 'CLOUDFLARE_SECRET_UPDATE_FAILED';
    throw definitivePatchError(error);
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
  return patchPagesProductionSecrets(env, project, { [name]: value }, fetchImpl);
}

export async function deletePagesProductionSecrets(env, project, names, fetchImpl = fetch) {
  const entries = Array.isArray(names) ? names : [names];
  return patchPagesProductionSecrets(
    env,
    project,
    Object.fromEntries(entries.map((name) => [name, null])),
    fetchImpl
  );
}

export async function patchPagesProductionSecrets(env, project, values = {}, fetchImpl = fetch) {
  const { accountId, apiToken } = cloudflareConfiguration(env);
  const targetProject = projectName(project);
  const variables = {};
  for (const [name, value] of Object.entries(values || {})) {
    const variableName = clean(name);
    if (!/^[A-Z][A-Z0-9_]{1,79}$/.test(variableName)
        || (value !== null && !clean(value))) {
      const error = new Error('The encrypted deployment variable is invalid.');
      error.status = 400;
      throw definitivePatchError(error);
    }
    variables[variableName] = value === null
      ? null
      : { type: 'secret_text', value: clean(value) };
  }
  if (!Object.keys(variables).length) {
    const error = new Error('At least one encrypted deployment variable is required.');
    error.status = 400;
    throw definitivePatchError(error);
  }
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(targetProject)}`;
  await cloudflareRequest(endpoint, {
    method: 'PATCH',
    headers: cloudflareHeaders(apiToken),
    body: JSON.stringify({
      deployment_configs: {
        production: {
          env_vars: {
            ...variables
          }
        }
      }
    })
  }, fetchImpl);
  const variableNames = Object.keys(variables);
  return {
    project: targetProject,
    variable: variableNames.length === 1 ? variableNames[0] : '',
    variables: variableNames
  };
}
