import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const admin=await readFile(new URL('../js/admin.js',import.meta.url),'utf8');
const source=admin.slice(admin.indexOf('function decodeNfcRecord('),admin.indexOf('function studentExportClass('));
function fixture(supported=true,permissionError=false) {
  let reader,submitted=0,cleared=0,status='',timer;
  const form={isConnected:true,elements:{AccountRef:{value:'PREVIOUS/001'},WalletCardId:{value:'',focus(){},dispatchEvent(){cleared++;}}},
    querySelector:selector=>selector.includes('status')?{}:{setAttribute(){}},requestSubmit(){submitted++;}};
  const button={textContent:'Scan card',innerHTML:'<svg></svg><span>Scan card</span>',isConnected:true,disabled:false};
  class Reader {constructor(){reader=this;this.events={};}addEventListener(key,handler){this.events[key]=handler;}async scan({signal}){this.signal=signal;if(permissionError)throw Object.assign(new Error('Denied'),{name:'NotAllowedError'});}}
  const window={setTimeout:callback=>{timer=callback;return 1;},clearTimeout:()=>{timer=null;},...(supported?{NDEFReader:Reader}:{})};
  const scan=runInNewContext(`${source}\nscanWalletNfc`,{window,NDEFReader:Reader,TextDecoder,URL,Event,AbortController,
    clean:v=>String(v??'').trim(),setStatus:(_el,message)=>{status=message;},setButtonLoading:(btn,busy)=>{btn.disabled=busy;}});
  return {form,button,scan,get reader(){return reader;},get submitted(){return submitted;},get cleared(){return cleared;},get status(){return status;},timeout:()=>timer?.()};
}
test('the original NFC helper scans once, clears the old admission identity and submits wallet lookup',async()=>{
  const f=fixture();await f.scan(f.form,f.button,{preserveMarkup:true});
  assert.equal(f.button.disabled,true);
  f.reader.events.reading({message:{records:[{data:new TextEncoder().encode('{"WalletCardId":"CARD-6"}')} ]}});
  assert.equal(f.form.elements.WalletCardId.value,'CARD-6');assert.equal(f.form.elements.AccountRef.value,'');
  assert.equal(f.cleared,1);assert.equal(f.submitted,1);assert.equal(f.button.disabled,false);assert.equal(f.reader.signal.aborted,true);
  assert.match(f.button.innerHTML,/<svg>/);
});
test('NFC cancellation, no-card timeout and navigation stop scanning without submitting',async()=>{
  for(const reason of ['cancel','timeout','navigate']) {
    const f=fixture(),controller=new AbortController();await f.scan(f.form,f.button,{signal:controller.signal});
    if(reason==='timeout')f.timeout();else {if(reason==='navigate')f.form.isConnected=false;controller.abort();}
    assert.equal(f.reader.signal.aborted,true);assert.equal(f.button.disabled,false);assert.equal(f.submitted,0);
    f.form.isConnected=false;f.reader.events.reading({serialNumber:'11:22:33'});assert.equal(f.submitted,0);
  }
});
test('unsupported browsers offer USB/manual entry; permission failure is actionable and not stuck',async()=>{
  const unsupported=fixture(false);await unsupported.scan(unsupported.form,unsupported.button);
  assert.match(unsupported.status,/Android Chrome.*USB reader/);assert.equal(unsupported.submitted,0);
  const denied=fixture(true,true);await denied.scan(denied.form,denied.button);
  assert.equal(denied.button.disabled,false);assert.match(denied.status,/permission was not granted/);
});
