import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../js/parent-dashboard.js',import.meta.url),'utf8');
const extract=name=>source.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n}`))[0];
function fixture(){
  const child={AccountRef:'TEST/1',SourceType:'Student',__scopePath:'schoolBranches/west/sections/secondary/students'};
  const calls=[],renders=[],button={disabled:false},status={textContent:''};let resolve,reject;
  const sandbox=vm.createContext({Date,Map,
    dashboard:{academicResults:{}},selectedChild:()=>child,academicResultsRequest:null,academicResultsVersions:new Map(),
    refreshAcademicResultsBtn:button,academicResultsStatus:status,
    setActionLoading:(button,busy)=>{button.disabled=busy;},renderAcademicResults:child=>renders.push(child.AccountRef),
    parentResultRequest:body=>{calls.push(body);return new Promise((res,rej)=>{resolve=res;reject=rej;});}
  });
  for(const name of ['childIdentity','childResult','setChildResult','refreshParentAcademicResults'])vm.runInContext(extract(name),sandbox);
  sandbox.selectedChildKey=sandbox.childIdentity(child);
  sandbox.setChildResult(sandbox.dashboard.academicResults,child,[{ResultId:'old',Access:{Allowed:false}}]);
  return {sandbox,child,calls,renders,button,status,resolve:value=>resolve(value),reject:error=>reject(error)};
}
test('refresh is explicit, coalesces repeated clicks, and updates only the selected child snapshot',async()=>{
  const f=fixture();assert.equal(f.calls.length,0);
  const pending=f.sandbox.refreshParentAcademicResults();await f.sandbox.refreshParentAcademicResults();
  assert.equal(f.calls.length,1);assert.equal(f.button.disabled,true);
  assert.equal(f.calls[0].action,'getChildAcademicResults');assert.equal(f.calls[0].scopePath,f.child.__scopePath);
  f.resolve({academicResults:[{ResultId:'new',Access:{Allowed:true}}]});await pending;
  assert.equal(f.button.disabled,false);assert.deepEqual(f.renders,['TEST/1']);
  assert.equal(f.sandbox.childResult(f.sandbox.dashboard.academicResults,f.child,[])[0].ResultId,'new');
});
test('a failed refresh retains earlier records and gives a retry message',async()=>{
  const f=fixture(),pending=f.sandbox.refreshParentAcademicResults();
  f.reject(new Error('Database unavailable'));await pending;
  assert.equal(f.sandbox.childResult(f.sandbox.dashboard.academicResults,f.child,[])[0].ResultId,'old');
  assert.match(f.status.textContent,/earlier view has been retained/);assert.equal(f.button.disabled,false);
});
test('a late response cannot overwrite a newer refresh, another parent dashboard or another child screen',async()=>{
  for(const mode of ['newer','dashboard','child']){
    const f=fixture(),pending=f.sandbox.refreshParentAcademicResults();
    if(mode==='newer')f.sandbox.academicResultsVersions.set(f.sandbox.selectedChildKey,99);
    if(mode==='dashboard')f.sandbox.dashboard={academicResults:{}};
    if(mode==='child')f.sandbox.selectedChildKey='other-child';
    f.resolve({academicResults:[{ResultId:'late'}]});await pending;
    assert.equal(f.renders.length,0);
    if(mode!=='child')assert.notEqual(f.sandbox.childResult(f.sandbox.dashboard.academicResults,f.child,[])[0]?.ResultId,'late');
  }
});
test('result requests have a bounded timeout, no caching, and no automatic retry reads',async()=>{
  let timer,cleared=0,requests=0;
  const sandbox=vm.createContext({AbortController,
    setTimeout:(callback,ms)=>{assert.equal(ms,30000);timer=callback;return 1;},clearTimeout:()=>cleared++,
    authPayload:()=>({email:'parent@example.test'}),freshBody:JSON.stringify,
    fetch:(_url,options)=>{requests++;assert.equal(options.cache,'no-store');return new Promise((_resolve,reject)=>{
      options.signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})));
    });}
  });
  vm.runInContext(extract('parentResultRequest'),sandbox);
  const pending=sandbox.parentResultRequest({action:'getChildAcademicResults'});timer();
  await assert.rejects(pending,/took too long/);assert.equal(cleared,1);assert.equal(requests,1);
});
