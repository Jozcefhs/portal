/* Isolated local previews: only fixtures and public vendor assets; no API or credentials. */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';

const files = new Map([
  ['/js/display-time.js',new URL('../../js/display-time.js',import.meta.url)],
  ['/tests/fixtures/boarding-offerings.html',new URL('../fixtures/boarding-offerings.html',import.meta.url)],
  ['/css/boarding-offerings.css',new URL('../../css/boarding-offerings.css',import.meta.url)],
  ['/js/boarding-offerings.js',new URL('../../js/boarding-offerings.js',import.meta.url)],
  ['/tests/fixtures/vendor-pos.html',new URL('../fixtures/vendor-pos.html',import.meta.url)],
  ['/images/Logo.png',new URL('../../images/Logo.png',import.meta.url)],
  ['/tests/fixtures/vendor-registration.html',new URL('../fixtures/vendor-registration.html',import.meta.url)],
  ['/tests/fixtures/staff-account-list.html',new URL('../fixtures/staff-account-list.html',import.meta.url)],
  ['/js/list-sorting.js',new URL('../../js/list-sorting.js',import.meta.url)],
  ['/css/style.css',new URL('../../css/style.css',import.meta.url)],
  ['/css/vendor-settlements.css',new URL('../../css/vendor-settlements.css',import.meta.url)],
  ['/js/vendor-pos.js',new URL('../../js/vendor-pos.js',import.meta.url)],
  ['/js/vendor-settlements.js',new URL('../../js/vendor-settlements.js',import.meta.url)],
  ['/js/vendor-sales-analysis.js',new URL('../../js/vendor-sales-analysis.js',import.meta.url)],
  ['/js/student-face-lookup.js',new URL('../../js/student-face-lookup.js',import.meta.url)]
]);
createServer(async(req,res) => {
  try {
    const path = new URL(req.url,'http://localhost').pathname;
    if (req.method === 'GET' && path === '/tests/fixtures/vendor-responsive.html') {
      const adminHtml = await readFile(new URL('../../admin.html',import.meta.url),'utf8');
      const fixture = await readFile(new URL('../fixtures/vendor-responsive.html',import.meta.url),'utf8');
      const header = adminHtml.slice(adminHtml.indexOf('<header class="staff-topbar">'),adminHtml.indexOf('</header>')+9)
        .replace('class="staff-identity" hidden','class="staff-identity"')
        .replace('Organisation Management Suite','Sample Academy')
        .replace('images/Logo.png','/images/Logo.png')
        .replace('id="staffDisplayName"></strong>','id="staffDisplayName">Sample vendor</strong>')
        .replace('id="staffRole"></small>','id="staffRole">Vendor User</small>')
        .replace('<button type="button" id="staffProfileTrigger"','<div class="notification-centre"><button class="staff-header-icon notification-trigger" aria-label="Notifications">🔔</button></div><button type="button" id="staffProfileTrigger"');
      const admin = await readFile(new URL('../../js/admin.js',import.meta.url),'utf8');
      const navigation = admin.slice(admin.indexOf('function renderMobileNavigation('),admin.indexOf('\nconst {',admin.indexOf('function renderMobileNavigation(')));
      const nav = `<nav id="staffMobileNav" class="staff-mobile-nav" aria-label="Mobile portal navigation"></nav><script>const mobileNav=document.getElementById('staffMobileNav'),moduleGrid=document.createElement('div'),tabIcons={overview:'⌂',students:'♟',accounts:'₦'},activeSection='overview',escapeHtml=v=>String(v);\n${navigation}\nrenderMobileNavigation([['overview','Home'],['students','Students'],['accounts','Accounts']],[]);</script>`;
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      res.end(fixture.replace('<!-- The fixture server inserts the real staff header and mobile navigation here. -->',header+nav));
      return;
    }
    if (req.method === 'GET' && path === '/tests/fixtures/staff-account-list-production.js') {
      const admin = await readFile(new URL('../../js/admin.js',import.meta.url),'utf8');
      const helpers = admin.slice(admin.indexOf('function alphabeticalStaffRoles('),admin.indexOf('function renderStaffUsers('));
      const render = admin.slice(admin.indexOf('function renderStaffUsers('),admin.indexOf('function renderRoleAccessEditor('));
      res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});
      res.end(`${helpers}\n${render}\nrenderStaffUsers();`);
      return;
    }
    if (req.method === 'GET' && path === '/tests/fixtures/staff-sidebar.html') {
      const adminHtml = await readFile(new URL('../../admin.html',import.meta.url),'utf8');
      const posHtml = await readFile(new URL('../fixtures/vendor-pos.html',import.meta.url),'utf8');
      // Production shell and POS with sample records only; never load the admin bootstrap or APIs.
      const header = adminHtml.slice(adminHtml.indexOf('<header class="staff-topbar">'),adminHtml.indexOf('</header>')+9)
        .replace('class="staff-identity" hidden','class="staff-identity"')
        .replace('Organisation Management Suite','Example Academy')
        .replace('id="staffDisplayName"></strong>','id="staffDisplayName">Sample vendor</strong>')
        .replace('id="staffRole"></small>','id="staffRole">Vendor User</small>');
      const sidebar = adminHtml.slice(adminHtml.indexOf('<aside class="staff-sidebar"'),adminHtml.indexOf('<div class="staff-main-content">'))
        .replace('aria-label="Staff dashboard sections"></nav>','aria-label="Staff dashboard sections"><button data-tab="vendorSettlements">Vendor Sales &amp; Settlements</button><button data-tab="tuckShop" class="selected">Tuck Shop</button></nav>');
      const scripts = posHtml.slice(posHtml.indexOf('<script src='),posHtml.lastIndexOf('</html>'));
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sidebar sample preview</title><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/vendor-settlements.css"><body class="staff-page">${header}<main class="staff-shell"><section id="staffDashboard" class="staff-dashboard"><div class="staff-app-layout">${sidebar}<div class="staff-main-content"><section id="root" class="staff-panel"></section></div></div></section></main><nav id="staffMobileNav" class="staff-mobile-nav" aria-label="Mobile portal navigation"><button id="fixtureShop">Tuck Shop</button><button id="fixtureMore">More</button></nav><script src="staff-sidebar-navigation.js"></script>${scripts}</body></html>`);
      return;
    }
    if (req.method === 'GET' && path === '/tests/fixtures/staff-sidebar-navigation.js') {
      const admin = await readFile(new URL('../../js/admin.js',import.meta.url),'utf8');
      const navigation = admin.slice(admin.indexOf('function syncSidebarNavigation()'),admin.indexOf('function clearStaffWorkspaceState()'));
      res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});
      res.end(`const dashboardEl=document.getElementById('staffDashboard'),sidebarEl=document.getElementById('staffSidebar'),sidebarScrim=document.getElementById('staffSidebarScrim'),sidebarToggleButton=document.getElementById('staffSidebarToggle'),staffAccountMenu=document.getElementById('staffAccountMenu'),moduleDialog={open:false};let desktopSidebarCollapsed=false;\n${navigation}\ninstallSidebarNavigation();installSidebarSwipeGestures();sidebarScrim.addEventListener('click',()=>setSidebarOpen(false));document.getElementById('fixtureMore').addEventListener('click',()=>setSidebarOpen(true));document.getElementById('fixtureShop').addEventListener('click',()=>setSidebarOpen(false));document.getElementById('adminTabs').addEventListener('click',()=>setSidebarOpen(false));document.addEventListener('keydown',event=>{if(event.key==='Escape')setSidebarOpen(false);});window.addEventListener('resize',()=>{if(window.innerWidth>680)setSidebarOpen(false);else syncSidebarNavigation();});`);
      return;
    }
    if (req.method === 'GET' && path === '/tests/fixtures/vendor-pos-shared-helpers.js') {
      const admin = await readFile(new URL('../../js/admin.js',import.meta.url),'utf8');
      const scanner = admin.slice(admin.indexOf('function decodeNfcRecord('),admin.indexOf('function studentExportClass('));
      const icons = admin.slice(admin.indexOf('function tuckShopLookupIcon('),admin.indexOf('function renderTuckShopPOS('));
      res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});
      res.end(`const clean=v=>String(v??'').trim();\nconst setStatus=(el,msg,tone)=>{if(el){el.textContent=msg;el.className='status '+(tone||'');}};\nconst setButtonLoading=(btn,busy,text,normal)=>{btn.disabled=busy;btn.textContent=busy?text:normal;};\n${scanner}\n${icons}\nwindow.vendorFixtureTools={scanNfc:scanWalletNfc,lookupIcon:tuckShopLookupIcon,openFaceLookup:async options=>(await import('/js/student-face-lookup.js')).openStudentFaceLookup(options)};`);
      return;
    }
    if (req.method !== 'GET' || !files.has(path)) {res.writeHead(404);res.end();return;}
    const type = path.endsWith('.png') ? 'image/png' : path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html';
    res.writeHead(200,{'Content-Type':`${type}; charset=utf-8`,'Cache-Control':'no-store'});
    res.end(await readFile(files.get(path)));
  } catch {res.writeHead(500);res.end('Fixture unavailable.');}
}).listen(8768,'127.0.0.1',() => console.log('Local POS fixture: http://127.0.0.1:8768/tests/fixtures/vendor-pos.html'));
