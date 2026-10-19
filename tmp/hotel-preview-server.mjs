import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const rooms = [ { RoomId: '101', RoomNumber: '101', RoomType: 'Standard', Capacity: 2, NightlyRate: 30000 }, { RoomId: '201', RoomNumber: '201', RoomType: 'Deluxe', Capacity: 3, NightlyRate: 50000 } ];
const roomTypes = rooms.map(r => ({ RoomType: r.RoomType, Description: 'Local preview fixture — room amenities and comfortable accommodation.', MediaType: 'image', MediaUrl: '/api/hotel-room-media?id=' + (r.RoomId === '101' ? 'a' : 'b').repeat(64) }));
const data = { rooms, roomTypes, capabilities: { canManageRooms: true }, keyDispenser: { DeviceId: 'a'.repeat(64), Name: 'Reception dispenser', CheckInHour: 14, CheckOutHour: 12, UtcOffsetMinutes: 60, Enabled: false } };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const json = obj => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
  if (url.pathname === '/api/public-hotel') return json({ ok: true, organisationName: 'Dynamax Hotel · Local preview', rooms, roomTypes });
  if (url.pathname === '/api/hotel-key-collection') return json({ ok: true, status: 'Reserved', roomNumber: '101', arrivalDate: '2026-10-13', departureDate: '2026-10-15', code: '123456', notBefore: '2026-10-13T13:00:00Z', expiresAt: '2026-10-15T11:00:00Z', message: 'Local preview only. This sample code cannot release any real key.' });
  if (url.pathname === '/js/site-config.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end('window.siteProfileReady=Promise.resolve({OrganisationName:"Dynamax Hotel · Local preview"});'); }
  if (url.pathname === '/api/hotel-room-media') { res.setHeader('Content-Type', 'image/svg+xml'); return res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#d4e7ed"/><text x="320" y="180" text-anchor="middle" font-size="28" fill="#17314b">Room photo preview fixture</text></svg>'); }
  if (url.pathname === '/staff-preview') { res.setHeader('Content-Type', 'text/html'); return res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/hotel-self-service.css"><main style="max-width:1100px;margin:20px auto;padding:16px"><h1>Hotel Services · local preview</h1><p id="hotelWorkspaceStatus" role="status"></p><div id="setup"></div></main><script src="/js/hotel-self-service-admin.js"></script><script>const data=${JSON.stringify(data)};DynamaxHotelSelfService.mount(document.getElementById('setup'),data,async()=>({...data,ok:true,message:'Local preview saved'}),()=>{},(m)=>document.getElementById('hotelWorkspaceStatus').textContent=m);</script>`); }
  if (url.pathname === '/mobile-preview') { res.setHeader('Content-Type', 'text/html'); return res.end('<!doctype html><title>Hotel mobile QA</title><iframe title="Hotel booking mobile" style="width:390px;height:844px;border:1px solid #ccc" src="/hotel-booking.html"></iframe><iframe title="Hotel setup mobile" style="width:390px;height:844px;border:1px solid #ccc" src="/staff-preview"></iframe>'); }
  const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(root + path.sep) || !['.html', '.js', '.css', '.png', '.svg'].includes(path.extname(file))) { res.writeHead(404); return res.end(); }
  try { const content = await fs.readFile(file); res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' })[path.extname(file)]); res.end(content); }
  catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(Number(process.argv[2] || 8794), '127.0.0.1', () => console.log('Local hotel preview ready'));
