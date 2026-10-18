import { escapeEmailHtml as esc } from './email-service.js';

const clean = value => String(value ?? '').trim();

// Mirrors suite/modules/executive_office.py: A4, centred 22 mm logo,
// 17 pt heading, 10.5/16 pt body, pale metadata tables and understated footer.
export function desktopExecutiveLetterHtml({ correspondence, identity, rendered, logo, watermarkImage, signature, stamp, paragraphs }) {
  const reference = clean(correspondence.Reference || correspondence.CorrespondenceId) || 'Draft';
  const rawDate = clean(correspondence.IssuedAt || correspondence.UpdatedAt).slice(0, 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && Number.isFinite(Date.parse(rawDate))
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${rawDate}T12:00:00Z`)) : rawDate;
  const tokens = rendered.tokenValues || correspondence.TokenValues || {};
  const details = correspondence.Kind === 'transfer-certificate' ? [
    ['Student', tokens.STUDENT_NAME || correspondence.RecipientName], ['Admission number', tokens.ADMISSION_NO || correspondence.RecipientId],
    ['Class', tokens.CLASS], ['Admission date', tokens.ADMISSION_DATE], ['Leaving date', tokens.LEAVING_DATE],
    ['Reason for leaving', tokens.REASON], ['Conduct / remarks', tokens.CONDUCT]
  ] : [];
  const subscriber = clean(identity.Code) || clean(identity.Name) || 'Organisation';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(rendered.subject)}</title>
<style>
@page{size:A4;margin:20mm 18mm 18mm;@bottom-right{content:"Page " counter(page);font:7pt Arial,sans-serif;color:#6b7788}}
*{box-sizing:border-box}body{margin:0;background:#eef3f8;color:#000;font:10.5pt/16pt Arial,Helvetica,sans-serif}
.document{position:relative;width:210mm;max-width:100%;min-height:297mm;margin:20px auto;padding:20mm 18mm 18mm;background:#fff}
.watermark{position:fixed;z-index:1;left:37mm;top:89mm;width:100mm;height:100mm;opacity:.045;background-image:${watermarkImage || 'none'};background-size:contain;background-position:center;background-repeat:no-repeat;pointer-events:none}
.letter-content{position:relative;z-index:2}header{text-align:center}.brand-logo{display:block;width:22mm;height:22mm;object-fit:contain;margin:0 auto}
.identity h1,.subject{font-size:17pt;line-height:21pt;color:#103a63;text-align:center;margin:0 0 4mm;font-weight:bold}
.contact{font-size:8.5pt;line-height:11pt;color:#526174;text-align:center}.meta{margin:6mm 0 7mm;width:100%;table-layout:fixed;border-collapse:collapse}
.meta th,.meta td,.details th,.details td{font-size:8.5pt;line-height:11pt;color:#526174;border:.5pt solid #cedbea;padding:5pt;vertical-align:top;text-align:left;overflow-wrap:anywhere}
.meta th{background:#eaf2fb}.meta th:nth-child(1){width:15%}.meta td:nth-child(2){width:32%}.meta th:nth-child(3){width:15%}
.body p{margin:0 0 4mm;orphans:3;widows:3}.details{width:100%;border-collapse:collapse;margin:0 0 7mm;break-inside:avoid}.details th{width:24%;background:#eef5ed}
.endorsement{break-inside:avoid}.endorsement-images{display:flex;align-items:center;gap:6mm}.signature-image{width:38mm;height:15mm;object-fit:contain}.stamp-image{width:24mm;height:24mm;object-fit:contain}
.signatory{margin:0 0 4mm}.footer{margin-top:7mm;font-size:8.5pt;line-height:11pt;color:#526174;break-inside:avoid}
@media screen{.document{box-shadow:0 2px 14px #cbd9e7}.watermark{position:absolute;left:calc(50% - 50mm);top:109mm}}
@media print{body{background:#fff;print-color-adjust:exact;-webkit-print-color-adjust:exact}.document{width:auto;max-width:none;min-height:0;margin:0;padding:0}.subject{break-after:avoid}header,.meta{break-inside:avoid}}
@media screen and (max-width:620px){.document{padding:24px}.meta th,.meta td{padding:4px;font-size:8pt}}
</style></head><body><article class="document"><div class="watermark" aria-hidden="true"></div><div class="letter-content">
<header>${logo}<div class="identity"><h1>${esc(identity.Name || 'Organisation')}</h1></div><div class="contact">${esc([identity.Address, identity.Phone, identity.Email].map(clean).filter(Boolean).join(' | '))}</div></header>
<table class="meta"><tbody><tr><th>Reference</th><td>${esc(reference)}</td><th>Date</th><td>${esc(date)}</td></tr><tr><th>Recipient</th><td>${esc(correspondence.RecipientName || '-')}</td><th>Organisation</th><td>${esc(correspondence.RecipientOrganisation || '-')}</td></tr></tbody></table>
<h2 class="subject">${esc(rendered.subject)}</h2><div class="body">${paragraphs}</div>
${details.length ? `<table class="details"><tbody>${details.map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(value || '-')}</td></tr>`).join('')}</tbody></table>` : ''}
<section class="endorsement"><div class="endorsement-images">${signature}${stamp}</div><p class="signatory"><strong>${esc(correspondence.IssuedBy || '-')}</strong><br>${esc(clean(correspondence.IssuerTitle) || 'Authorised Officer')}</p></section>
<footer class="footer">Generated from the ${esc(subscriber)} Executive Office. Validate this document using its reference number.</footer>
</div></article></body></html>`;
}
