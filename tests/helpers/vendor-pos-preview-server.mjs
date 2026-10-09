/* Isolated local preview: only fixture and public POS assets; no API or credentials. */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';

const files = new Map([
  ['/tests/fixtures/vendor-pos.html',new URL('../fixtures/vendor-pos.html',import.meta.url)],
  ['/css/style.css',new URL('../../css/style.css',import.meta.url)],
  ['/css/vendor-settlements.css',new URL('../../css/vendor-settlements.css',import.meta.url)],
  ['/js/vendor-pos.js',new URL('../../js/vendor-pos.js',import.meta.url)],
  ['/js/student-face-lookup.js',new URL('../../js/student-face-lookup.js',import.meta.url)]
]);
createServer(async(req,res) => {
  try {
    const path = new URL(req.url,'http://localhost').pathname;
    if (req.method === 'GET' && path === '/tests/fixtures/vendor-pos-shared-helpers.js') {
      const admin = await readFile(new URL('../../js/admin.js',import.meta.url),'utf8');
      const scanner = admin.slice(admin.indexOf('function decodeNfcRecord('),admin.indexOf('function studentExportClass('));
      const icons = admin.slice(admin.indexOf('function tuckShopLookupIcon('),admin.indexOf('function renderTuckShopPOS('));
      res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});
      res.end(`const clean=v=>String(v??'').trim();\nconst setStatus=(el,msg,tone)=>{if(el){el.textContent=msg;el.className='status '+(tone||'');}};\nconst setButtonLoading=(btn,busy,text,normal)=>{btn.disabled=busy;btn.textContent=busy?text:normal;};\n${scanner}\n${icons}\nwindow.vendorFixtureTools={scanNfc:scanWalletNfc,lookupIcon:tuckShopLookupIcon,openFaceLookup:async options=>(await import('/js/student-face-lookup.js')).openStudentFaceLookup(options)};`);
      return;
    }
    if (req.method !== 'GET' || !files.has(path)) {res.writeHead(404);res.end();return;}
    const type = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html';
    res.writeHead(200,{'Content-Type':`${type}; charset=utf-8`,'Cache-Control':'no-store'});
    res.end(await readFile(files.get(path)));
  } catch {res.writeHead(500);res.end('Fixture unavailable.');}
}).listen(8768,'127.0.0.1',() => console.log('Local POS fixture: http://127.0.0.1:8768/tests/fixtures/vendor-pos.html'));
