import { rgb } from 'pdf-lib';
import { createAssets, drawLetterBackground } from './admission-pdf.js';

// Use the same custom document logo, watermark, border and letterhead as letters.
// Clinic referrals do not inherit an admissions/principal signature.
const printable = value => String(value ?? '').replace(/[’‘]/g, "'").replace(/[“”]/g, '"')
  .replace(/[–—]/g, '-').replace(/[^\x20-\x7e\n]/g, ' ').trim();

export async function createClinicReferralPdf(profile, letter, { signatureDataUrl = '' } = {}) {
  const assets = await createAssets({ ...profile, DocumentSignatureDataUrl: signatureDataUrl });
  const { pdf, regular, bold, signature } = assets;
  if (signatureDataUrl && !signature) {
    throw Object.assign(new Error('Your saved signature could not be added to the PDF. Open My signature settings, save a clear signature image and try again.'), { status: 400 });
  }
  pdf.setTitle('Clinic hospital referral');
  pdf.setAuthor(printable(profile.SchoolName || 'Clinic department'));
  let page, y;
  const nextPage = () => {
    page = pdf.addPage([612, 792]);
    drawLetterBackground(page, assets, profile, '');
    // The letterhead logo ends at y=704. Leave 30pt of clear space above
    // the 14pt heading (and reserve the same header area on later pages).
    y = 660;
  };
  nextPage();
  // Character-aware wrapping also handles long IDs/URLs without overflowing.
  const wrappedLines = (value, font, size) => {
    return printable(value).split('\n').flatMap(paragraph => {
      let line = '';
      const lines = [];
      for (const word of paragraph.split(/\s+/)) {
        if (line && font.widthOfTextAtSize(`${line} ${word}`, size) > 496) { lines.push(line); line = ''; }
        for (const char of `${line ? ' ' : ''}${word}`) {
          if (font.widthOfTextAtSize(line + char, size) > 496) { lines.push(line); line = ''; }
          line += char;
        }
      }
      lines.push(line);
      return lines;
    });
  };
  const write = (value, { font = regular, size = 10.5, gap = 6 } = {}) => {
    for (const text of wrappedLines(value, font, size)) {
      if (y < 82) nextPage();
      if (text) page.drawText(text, { x: 58, y, size, font, color: rgb(.13, .13, .13) });
      y -= 14;
    }
    y -= gap;
  };
  const section = (title, value) => {
    if (y < 126) nextPage();
    write(title, { font: bold, gap: 1 });
    write(value || 'Not recorded.');
  };
  write('CLINIC HOSPITAL REFERRAL', { font: bold, size: 14, gap: 10 });
  write(`Reference: ${letter.ReferralId}\nDate: ${letter.ReferralDate}`, { size: 9 });
  write('To: Parent / Guardian', { font: bold });
  write(`Student: ${letter.StudentName}\nAdmission number: ${letter.AccountRef}\nClass: ${letter.ClassName || 'Not recorded'}\nClinic visit: ${letter.VisitDate}`);
  write(`Dear Parent / Guardian,\nYour child / ward attended our clinic and requires further medical attention. Please take this referral letter to ${letter.Hospital} and share it with the attending healthcare professional.`);
  section('Reason for hospital referral', letter.Reason);
  section('Clinical observations', letter.Observations);
  section('Care / treatment already provided', letter.Treatment);
  if (letter.Instructions) section('Instructions / follow-up from the clinic', letter.Instructions);
  // Keep the closing identity, signature and automatic date together.
  const closing = `Prepared by: ${letter.PreparedBy}\nRole: ${letter.ClinicianTitle}\nClinic contact: ${letter.ClinicContact || 'Contact the school clinic'}`;
  const dimensions = signature?.scaleToFit(150, 48);
  const closingHeight = wrappedLines(closing, regular, 10.5).length * 14 + 12
    + (dimensions ? dimensions.height + 14 : 0) + 20;
  if (y - closingHeight < 82) nextPage();
  write(closing, { gap: 12 });
  if (signature) {
    page.drawImage(signature, { x: 58, y: y - dimensions.height, ...dimensions });
    y -= dimensions.height + 14;
    write(`Issuing officer's signature | Date: ${letter.ReferralDate}`, { size: 9 });
  } else {
    write(`Clinic signature: ______________________ | Date: ${letter.ReferralDate}`, { size: 9 });
  }
  const pages = pdf.getPages();
  pages.forEach((sheet, index) => {
    sheet.drawText(`Confidential - for the parent / guardian and receiving healthcare professional.`,
      { x: 58, y: 51, size: 8, font: regular, color: rgb(.3, .3, .3) });
    sheet.drawText(`Page ${index + 1} of ${pages.length}`, { x: 480, y: 39, size: 8, font: regular });
  });
  return pdf.save();
}
