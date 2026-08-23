import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildDeploymentMatrix } from './organisation-deployment-matrix.mjs';

const clean = (value) => String(value ?? '').trim();

function workerNameFor(organisationId) {
  const base = `dynamax-notify-${clean(organisationId).toLowerCase()}`;
  if (base.length <= 63) return base;
  const digest = createHash('sha256').update(base).digest('hex').slice(0, 10);
  return `${base.slice(0, 52)}-${digest}`;
}

export function buildNotificationWorkerConfig(organisation) {
  if (!organisation?.id || !organisation?.cloudflareProject || !organisation?.workspaceId || !organisation?.edition) {
    throw new Error('A complete organisation deployment record is required.');
  }
  return {
    $schema: './node_modules/wrangler/config-schema.json',
    name: workerNameFor(organisation.id),
    main: 'workers/notification-scheduler/index.js',
    compatibility_date: '2026-08-23',
    compatibility_flags: ['nodejs_compat'],
    workers_dev: false,
    preview_urls: false,
    triggers: { crons: ['*/5 * * * *'] },
    observability: {
      enabled: true,
      head_sampling_rate: 1
    },
    vars: {
      SCHEDULER_ENDPOINT: `https://${organisation.cloudflareProject}.pages.dev/api/notification-scheduler`,
      EXPECTED_WORKSPACE_ID: organisation.workspaceId,
      EXPECTED_EDITION: organisation.edition,
      MAX_ANNOUNCEMENT_CALLS: '15',
      MAX_ATTENDANCE_CALLS: '5'
    }
  };
}

function argumentValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? clean(process.argv[index + 1]) : fallback;
}

async function main() {
  const organisationId = argumentValue('--organisation');
  const output = argumentValue('--output');
  if (!organisationId) throw new Error('--organisation is required.');
  if (!output) throw new Error('--output is required.');
  const registry = JSON.parse(await readFile(new URL('../deploy/organisations.json', import.meta.url), 'utf8'));
  const [organisation] = buildDeploymentMatrix(registry, { target: organisationId });
  await writeFile(resolve(output), `${JSON.stringify(buildNotificationWorkerConfig(organisation), null, 2)}\n`, 'utf8');
  process.stdout.write(`Prepared ${workerNameFor(organisation.id)} for ${organisation.name}.\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
