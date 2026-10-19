import { ensureCloudflareR2Storage } from './cloudflare-r2.mjs';

const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? String(args[index + 1] || '').trim() : '';
};

const result = await ensureCloudflareR2Storage({
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  token: process.env.CLOUDFLARE_API_TOKEN,
  projectName: value('project') || process.env.CLOUDFLARE_PROJECT,
  bucketName: value('bucket') || process.env.DYNAMAX_R2_BUCKET,
  binding: value('binding') || 'DYNAMAX_DOCUMENTS'
});

process.stdout.write(`Cloudflare R2 ready: ${result.projectName} -> ${result.binding} (${result.bucketName})\n`);
