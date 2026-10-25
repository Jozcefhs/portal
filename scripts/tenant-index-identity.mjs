import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// These existing projects were provisioned under the faith deployment identity.
// Keep their original trust boundary; later pool projects use the provisioner.
const legacyProjects = new Set([
  'dynamax-tenant-002', 'dynamax-tenant-003', 'dynamax-tenant-004',
  'dynamax-tenant-006', 'dynamax-tenant-007', 'dynamax-tenant-009'
]);

export function tenantIndexIdentity(project, defaults = {}) {
  if (!/^dynamax-tenant-[a-z0-9-]+$/.test(String(project || ''))) {
    throw new Error('A valid tenant project is required for index deployment.');
  }
  const identity = legacyProjects.has(project)
    ? { projectId: 'digc-suite', serviceAccount: 'github-firestore-indexes@digc-suite.iam.gserviceaccount.com' }
    : defaults;
  if (!/^[a-z][a-z0-9-]+$/.test(String(identity.projectId || ''))
      || !/^[a-z0-9-]+@[a-z][a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(String(identity.serviceAccount || ''))) {
    throw new Error('The tenant index deployment identity is not configured.');
  }
  return { projectId: identity.projectId, serviceAccount: identity.serviceAccount };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const identity = tenantIndexIdentity(process.env.FIREBASE_PROJECT_ID, {
    projectId: process.env.DEFAULT_INDEX_PROJECT_ID,
    serviceAccount: process.env.DEFAULT_INDEX_SERVICE_ACCOUNT
  });
  if (!process.env.GITHUB_OUTPUT) throw new Error('GitHub step output path is required.');
  appendFileSync(process.env.GITHUB_OUTPUT,
    `project_id=${identity.projectId}\nservice_account=${identity.serviceAccount}\n`);
}
