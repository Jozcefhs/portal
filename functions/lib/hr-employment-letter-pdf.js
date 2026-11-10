import { rgb } from 'pdf-lib';
import { createAssets } from './admission-pdf.js';

const text = value => String(value ?? '').replace(/[’‘]/g, "'").replace(/[“”]/g, '"')
  .replace(/[–—]/g, '-').replace(/[^\x20-\x7e\n]/g, ' ').trim();
const navy = rgb(.08, .22, .36), muted = rgb(.32, .38, .43), ink = rgb(.12, .16, .2);
const money = value => `NGN ${Number(value || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function createEmploymentLetterPdf(profile, letter, { signatureDataUrl = '' } = {}) {
  const assets = await createAssets({ ...profile, DocumentSignatureDataUrl: signatureDataUrl });
  const { pdf, regular, bold, logo, signature } = assets;
  if (signatureDataUrl && !signature) throw Object.assign(new Error('Your saved signature could not be added to the PDF. Save a PNG or JPG signature in My signature settings.'), { status: 400 });
  pdf.setTitle(`Employment letter - ${text(letter.EmployeeName)}`);
  pdf.setAuthor(text(letter.EmployerName));
  let page, y;
  const lines = (value, font = regular, size = 10, width = 487) => text(value).split('\n').flatMap(paragraph => {
    const result = []; let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (line && font.widthOfTextAtSize(`${line} ${word}`, size) > width) { result.push(line); line = ''; }
      for (const char of `${line ? ' ' : ''}${word}`) {
        if (font.widthOfTextAtSize(line + char, size) > width) { result.push(line); line = ''; }
        line += char;
      }
    }
    return [...result, line];
  });
  const nextPage = () => {
    page = pdf.addPage([595, 842]);
    page.drawRectangle({ x: 30, y: 30, width: 535, height: 782, borderColor: rgb(.78, .84, .88), borderWidth: .8 });
    if (logo) { const size = logo.scaleToFit(52, 52); page.drawImage(logo, { x: 51, y: 741, ...size }); }
    const x = logo ? 116 : 54, width = logo ? 425 : 487;
    let headerY = 785;
    for (const line of lines(letter.EmployerName, bold, 14, width).slice(0, 3)) {
      page.drawText(line, { x, y: headerY, size: 14, font: bold, color: navy }); headerY -= 17;
    }
    for (const line of lines([profile.SchoolAddress, [profile.SchoolPhone, profile.SchoolEmail].filter(Boolean).join(' | ')].filter(Boolean).join('\n'), regular, 8, width).slice(0, 3)) {
      page.drawText(line, { x, y: headerY - 3, size: 8, font: regular, color: muted }); headerY -= 11;
    }
    const ruleY = Math.min(725, headerY - 13);
    page.drawLine({ start: { x: 54, y: ruleY }, end: { x: 541, y: ruleY }, thickness: 1.5, color: navy });
    y = ruleY - 25;
  };
  const ensure = height => { if (y - height < 63) nextPage(); };
  const write = (value, { font = regular, size = 10, gap = 6 } = {}) => {
    for (const line of lines(value, font, size)) {
      ensure(15); if (line) page.drawText(line, { x: 54, y, size, font, color: ink }); y -= 14;
    }
    y -= gap;
  };
  const section = (label, value) => {
    if (!text(value)) return;
    ensure(48); write(label, { font: bold, gap: 1 }); write(value);
  };
  const salaryRow = (label, amount, total = false) => {
    const rowLines = lines(label, total ? bold : regular, 9.5, 340), height = Math.max(25, rowLines.length * 13 + 10);
    ensure(height + 2);
    page.drawRectangle({ x: 54, y: y - height + 10, width: 487, height, color: total ? rgb(.9, .95, .96) : rgb(.97, .98, .99), borderColor: rgb(.8, .85, .89), borderWidth: .5 });
    rowLines.forEach((line, index) => page.drawText(line, { x: 62, y: y - index * 13, size: 9.5, font: total ? bold : regular, color: ink }));
    const value = money(amount), font = total ? bold : regular;
    page.drawText(value, { x: 531 - font.widthOfTextAtSize(value, 9.5), y, size: 9.5, font, color: ink });
    y -= height;
  };
  nextPage();
  write('LETTER OF EMPLOYMENT', { font: bold, size: 15, gap: 11 });
  write(`Date: ${letter.Terms.LetterDate}\nReference: ${letter.LetterId || 'Preview - not saved'}`, { size: 8.5 });
  write(`Private and confidential\n${letter.EmployeeName}\n${letter.RecipientEmail}`, { gap: 9 });
  write(`Dear ${letter.EmployeeName},\n${letter.EmployerName} offers you employment as ${letter.Terms.Position}, commencing on ${letter.Terms.StartDate}, subject to the terms set out in this letter.`);
  section('Appointment', [
    `Position: ${letter.Terms.Position}`, `Department: ${letter.Terms.Department}`,
    `Employment type: ${letter.Terms.EmploymentType}`, `Branch: ${letter.BranchName || letter.BranchId}`,
    letter.Terms.WorkLocation && `Work location: ${letter.Terms.WorkLocation}`,
    letter.Terms.ReportingTo && `Reporting to: ${letter.Terms.ReportingTo}`
  ].filter(Boolean).join('\n'));
  ensure(65); write('Remuneration - NGN per month', { font: bold, gap: 8 });
  for (const row of letter.Salary.Earnings) salaryRow(row.Name, row.Amount);
  salaryRow('Gross monthly salary', letter.Salary.GrossPay, true); y -= 10;
  if (letter.Salary.Deductions.length) {
    ensure(55); write('Recorded recurring deductions', { font: bold, gap: 8 });
    for (const row of letter.Salary.Deductions) salaryRow(row.Name, row.Amount);
    y -= 10;
  }
  write('Gross remuneration is shown above. Statutory deductions and authorised payroll adjustments are determined through payroll; this letter is not a payslip or a promise of net take-home pay.', { size: 8.5 });
  for (const [label, key] of [['Probation', 'Probation'], ['Working hours', 'WorkingHours'], ['Benefits', 'Benefits'], ['Notice period', 'NoticePeriod'], ['Additional employment terms', 'Terms']]) section(label, letter.Terms[key]);
  if (letter.Terms.AcceptanceDeadline) section('Acceptance deadline', letter.Terms.AcceptanceDeadline);
  ensure(130);
  write('Yours sincerely,', { gap: 7 });
  if (signature) { const size = signature.scaleToFit(140, 45); page.drawImage(signature, { x: 54, y: y - size.height, ...size }); y -= size.height + 9; }
  write(`${letter.IssuerName}\n${letter.IssuerTitle}\nFor ${letter.EmployerName}`, { font: bold, gap: 12 });
  ensure(75);
  section('Employee acceptance', 'I accept this appointment and the terms stated in this letter.\nSignature: ___________________________    Date: __________________');
  pdf.getPages().forEach((sheet, index, pages) => {
    sheet.drawText('Private and confidential - employment record', { x: 54, y: 45, size: 8, font: regular, color: muted });
    sheet.drawText(`Page ${index + 1} of ${pages.length}`, { x: 470, y: 45, size: 8, font: regular, color: muted });
  });
  return pdf.save();
}
