import test from 'node:test';
import assert from 'node:assert/strict';
import { hasRootProof, ownershipRecord, prepareRootRecords, importRootRecords, reviewRootRecords } from '../functions/lib/root-domain-setup.js';
import { tenantControlCanonicalRequest } from '../functions/lib/tenant-control-plane.js';

const host = 'sampleacademy.org', project = 'tenant-one', zone = 'a'.repeat(32);
const env = { DYNAMAX_ROOT_DNS_TOKEN: 'unit-test', CLOUDFLARE_ACCOUNT_ID: 'account' };
test('ownership is scoped to the exact TXT name, value and workspace', async t => {
  const proof = await ownershipRecord(project, 'reg-a', host);
  const other = await ownershipRecord(project, 'reg-b', host);
  assert.notEqual(proof.value, other.value);
  const answers = [{name:'another.'+host,type:16,data:JSON.stringify(proof.value)}, {name:proof.name,type:16,data:JSON.stringify(other.value)}];
  t.mock.method(globalThis,'fetch',async (url, init) => {
    assert.equal(new URL(url).hostname,'dns.google'); assert.equal(init.headers,undefined);
    return Response.json({Status:0, Answer:answers});
  });
  assert.equal(await hasRootProof(proof),false);
  answers.push({name:proof.name+'.',type:16,data:JSON.stringify(proof.value)});
  assert.equal(await hasRootProof(proof),true);
});
test('routing changes only staging apex addresses, blocks DS and preserves other records',async t => {
  let ds = true;
  const records = [{name:host,id:'old',type:'A',content:'192.0.2.1'},{name:host,type:'MX',id:'mail',content:'mail.example.org'},
    {name:'www.'+host,id:'www',type:'A',content:'192.0.2.1'}], writes=[];
  t.mock.method(globalThis,'fetch',async (url,init) => {
    if (new URL(url).hostname === 'dns.google') return Response.json({Status:0,Answer:ds?[{name:host,type:43}]:[]});
    assert.equal(init.redirect,'manual'); assert.equal(init.headers.Authorization,'Bearer unit-test');
    if(init.method === 'POST') writes.push(JSON.parse(init.body));
    return Response.json({success:true,result:records});
  });
  await assert.rejects(prepareRootRecords(env,zone,host,project,true), /DNSSEC/);
  ds=false; await assert.rejects(prepareRootRecords(env,zone,host,project,false), /already active/);
  await prepareRootRecords(env,zone,host,project,true);
  assert.deepEqual(writes,[{deletes:[{id:'old'}],posts:[{type:'CNAME',name:host,content:'tenant-one.pages.dev',ttl:1,proxied:true}]}]);
  records[0]={...writes[0].posts[0],id:'correct'};
  await prepareRootRecords(env,zone,host,project,true);
  assert.equal(writes.length,1);
});
test('review paginates, and import content is bound to the signed request', async t => {
  const details={action:'domain-import', workspaceId:project, zoneFile:'a'};
  assert.notEqual(await tenantControlCanonicalRequest(details),await tenantControlCanonicalRequest({...details,zoneFile:'b'}));
  t.mock.method(globalThis,'fetch',async (url,init) => {
    if(init.method==='POST'){
      assert.equal(await init.body.get('file').text(),'example content');
      assert.equal(init.body.get('proxied'),'false');
      return Response.json({success:true,result:{recs_added:1}});
    }
    return Response.json({success:true,result_info:{total_pages:2},result:[{name:host,type:'TXT',content:new URL(url).searchParams.get('page')}]});
  });
  assert.deepEqual((await reviewRootRecords(env,zone)).map(x=>x.content),['1','2']);
  await importRootRecords(env,zone,'example content');
  await assert.rejects(importRootRecords(env,zone,''), /Choose/);
});
