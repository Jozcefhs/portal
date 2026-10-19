import { run } from 'node:test';
let failed = false;
for await (const event of run({ files: process.argv.slice(2), concurrency: 1 })) {
  if (event.type === 'test:fail') {
    failed = true;
    const err = event.data.details.error;
    console.log('FAIL', event.data.name, String(err?.cause?.message || err?.message).slice(0, 500));
    console.log(String(err?.cause?.stack || '').split('\n').filter(s => s.includes('at ')).slice(0, 3).join('\n'));
  }
  if (event.type === 'test:summary') console.log(JSON.stringify(event.data.counts));
}
process.exitCode = failed ? 1 : 0;
