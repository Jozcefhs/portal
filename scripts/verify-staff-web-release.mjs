import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const files=['js/staff-meetings.js','css/staff-meetings.css','admin.html','js/admin.js','css/academic-class-score-register.css','css/web-release.css','js/web-release.js','js/academic-audit-log.js','css/module-audit.css','css/academic-result-preview.css','js/academic-component-review.js','css/academic-test-review.css','js/academic-result-template.js','parent-dashboard.html','js/parent-dashboard.js','css/parent-academic-results.css','sw.js'];
const hash=text=>createHash('sha256').update(text.replace(/\r\n/g,'\n').replace(/^\uFEFF/,'')).digest('hex');
export async function verifyStaffWebRelease(base,{fetcher=fetch,read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8')}={}) {
  const url=new URL(base);
  const results=await Promise.all(files.map(async path=>{
    const source=await read(path),target=new URL('/'+path,url);target.searchParams.set('release-check',hash(source).slice(0,16));
    const response=await fetcher(target,{cache:'no-store',headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(25000)});
    if(!response.ok)throw new Error(`${path}: HTTP ${response.status}`);
    if(hash(await response.text())!==hash(source))throw new Error(`${path}: the deployed file differs from this release.`);
    return path;
  }));
  return {url:url.origin,verified:results};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const index=process.argv.indexOf('--url'),url=index>=0?process.argv[index+1]:'';
  if(!url)throw new Error('--url is required.');
  for(let attempt=1;attempt<=5;attempt++) {
    try { console.log(JSON.stringify(await verifyStaffWebRelease(url))); break; }
    catch(error) { if(attempt===5)throw error; console.warn(`Staff assets are not current yet: ${error.message}`); await new Promise(resolve=>setTimeout(resolve,5000)); }
  }
}
