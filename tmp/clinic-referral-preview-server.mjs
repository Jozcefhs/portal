import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const files = new Map([
  ['/js/clinic-referrals.js', '../js/clinic-referrals.js'], ['/css/style.css', '../css/style.css'],
  ['/js/app-dialogs.js', '../js/app-dialogs.js'], ['/sample.pdf', '../output/pdf/clinic-hospital-referral-sample.pdf']
  , ['/css/app-dialogs.css', '../css/app-dialogs.css']
]);
const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Clinic referral - offline sample</title><link rel="stylesheet" href="/css/style.css"><script defer src="/js/app-dialogs.js"></script></head>
<body><main style="max-width:1100px;margin:20px auto;padding:12px"><p>OFFLINE TEST ONLY. No patient data or outgoing email.</p><section class="config-card" id="clinicReferralWorkspace"></section><p id="test-count">0 simulated email sends</p></main>
<script type="module">
import { mountClinicReferrals } from '/js/clinic-referrals.js';
const bytes = new Uint8Array(await (await fetch('/sample.pdf')).arrayBuffer());
let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
const student = { AccountRef: 'SAMPLE/001', StudentName: 'Sample Learner', ClassName: 'Grade 10', ParentEmail: 'parent@example.org' };
let current = null, sends = 0;
mountClinicReferrals(document.getElementById('clinicReferralWorkspace'), { accountRef: 'SAMPLE/001', today: '2026-10-16',
  setStatus: (node, text, type) => { node.textContent = text; node.className = 'status ' + type; },
  request: async (action, body) => {
    if (action === 'prepareClinicReferral') return { student, referrals: current ? [current] : [], visits: [{ VisitId: 'CLN-001', Date: '2026-10-16', Complaint: 'Sample complaint for testing only', Treatment: 'Sample recorded care', Disposition: 'Referred to hospital' }], message: 'Sample visit loaded.' };
    if (action === 'previewClinicReferral') {
      if (!body.Hospital || !body.VisitId || !body.Reason) throw new Error('Form values missing.');
      current = { ...student, ...body, ReferralId: 'REF-sample', Status: 'Draft', PdfBase64: btoa(binary), FileName: 'sample-referral.pdf' };
      return { referral: current, message: 'Sample preview generated. No email sent.' };
    }
    if (action === 'sendClinicReferral') {
      if (!body.ConfirmSend || body.ConfirmedParentEmail !== student.ParentEmail) throw new Error('Confirmation missing.');
      sends++; document.getElementById('test-count').textContent = sends + ' simulated email sends';
      current.Status = 'Sent'; return { referral: current, message: 'SIMULATION ONLY: send confirmed. No real email was sent.' };
    }
    if (action === 'loadClinicReferral') return { referral: current };
    throw new Error('Unexpected test action');
  }
});
</script></body></html>`;
createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page); return; }
  if (!files.has(path)) { res.writeHead(404); res.end(); return; }
  const contents = await readFile(new URL(files.get(path), import.meta.url));
  res.writeHead(200, { 'Content-Type': path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'application/pdf' }); res.end(contents);
}).listen(8768, '127.0.0.1', () => console.log('Offline clinic preview: http://127.0.0.1:8768'));
