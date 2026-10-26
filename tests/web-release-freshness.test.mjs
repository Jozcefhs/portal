import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = path => readFile(new URL(`../${path}`,import.meta.url),'utf8');
const [script,worker,html] = await Promise.all(['js/web-release.js','sw.js','admin.html'].map(read));
function harness() {
  let clock=0,remote='dynamax-v482-web-release-notice',failure=false,reloads=0,fetches=0;
  const events={},messages={},nodes=[];
  const createElement=tag=>({tag,children:[],listeners:{},setAttribute(){},append(...children){this.children.push(...children);},addEventListener(name,fn){this.listeners[name]=fn;}});
  const document={hidden:false,querySelector:()=>({content:'dynamax-v482-web-release-notice'}),createElement,
    body:{prepend:node=>nodes.push(node)},addEventListener:(name,fn)=>{events[name]=fn;}};
  const context={document,Date:{now:()=>clock},AbortController,setTimeout:()=>1,clearTimeout(){},setInterval(){},
    window:{location:{reload:()=>reloads++},addEventListener:(name,fn)=>{events[name]=fn;}},
    navigator:{serviceWorker:{addEventListener:(name,fn)=>{messages[name]=fn;}}},
    fetch:async(url,options)=>{fetches++;assert.equal(url,'/sw.js');assert.equal(options.cache,'no-store');assert.equal(options.credentials,'omit');
      if(failure)throw new Error('Offline');return {ok:true,text:async()=>`const CACHE = '${remote}';`};}};
  vm.runInNewContext(script,context);
  return {nodes,events,messages,document,clock:value=>clock=value,remote:value=>remote=value,fail:()=>failure=true,
    counts:()=>({fetches,reloads}),flush:()=>new Promise(resolve=>setImmediate(resolve))};
}

test('loaded HTML release matches its service worker, with update detection in the staff shell',()=>{
  const release=/const CACHE = '([^']+)'/.exec(worker)[1];
  assert.equal(/name="dynamax-web-release" content="([^"]+)"/.exec(html)[1],release);
  assert.match(html,/js\/web-release\.js\?v=/);assert.match(html,/css\/web-release\.css\?v=/);
});

test('a newer release shows one notice, keeps current work, and reloads only on explicit click',async()=>{
  const h=harness();await h.flush();assert.equal(h.nodes.length,0);
  h.remote('dynamax-v483-next-update');h.clock(300001);await h.events.focus();await h.flush();
  assert.equal(h.nodes.length,1);assert.equal(h.counts().reloads,0);
  assert.match(h.nodes[0].children[0].textContent,/Save any unfinished work/);
  h.messages.message({data:{type:'dynamax:web-release',release:'dynamax-v484-further-update'}});
  assert.equal(h.nodes.length,1);assert.equal(h.counts().reloads,0);
  h.nodes[0].children[1].listeners.click();assert.equal(h.counts().reloads,1);
});

test('checks are throttled and do not poll hidden tabs or the database',async()=>{
  const h=harness();await h.flush();for(let i=0;i<20;i++){h.events.focus();h.events.pageshow();h.events.visibilitychange();}
  await h.flush();assert.equal(h.counts().fetches,1);
  h.clock(400000);h.document.hidden=true;h.events.visibilitychange();h.events.focus();await h.flush();assert.equal(h.counts().fetches,1);
  h.document.hidden=false;await h.events.focus();await h.flush();assert.equal(h.counts().fetches,2);
});

test('offline failures and older or equal releases never reload or claim an update',async()=>{
  const h=harness();await h.flush();h.messages.message({data:{type:'dynamax:web-release',release:'dynamax-v481-old'}});
  h.fail();h.clock(400000);await h.events.pageshow();await h.flush();
  assert.equal(h.nodes.length,0);assert.equal(h.counts().reloads,0);
});

test('offline versioned assets cannot fall back to an unrelated cached version',async()=>{
  const events={},lookups=[];
  const context={URL,Response,self:{location:{origin:'https://example.test'},addEventListener:(name,fn)=>{events[name]=fn;}},
    fetch:async()=>{throw new Error('offline');},caches:{match:async(request,options)=>{lookups.push(options);return new Response('cached');}}};
  vm.runInNewContext(worker,context);
  for(const path of ['/js/admin.js?v=new','/css/style.css?v=new','/images/Logo.png']){
    let response;events.fetch({request:new Request(`https://example.test${path}`),waitUntil(){},respondWith:promise=>response=promise});
    await response;
  }
  assert.deepEqual(lookups.map(value=>value.ignoreSearch),[false,false,true]);
});
