import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';

const LETTER = [612, 792];
const BLUE = rgb(31 / 255, 78 / 255, 121 / 255);
const TEXT = rgb(34 / 255, 34 / 255, 34 / 255);
const MUTED = rgb(80 / 255, 80 / 255, 80 / 255);

const DEFAULT_OFFER_BODY = `Dear Parent/Guardian,
Calvary greetings to you in the name of our Lord Jesus Christ.

Following your application for admission into our prestigious school, we have carefully reviewed each applicant through our standardized entrance examination, as well as character and moral assessments conducted via oral interviews.

Based on these criteria, the Admissions Committee is pleased to offer {FULL_NAME} admission into {CLASS} for the {SESSION} academic session.

Kindly proceed with the required documentation and payment of the registration deposit to secure your child's place:
- Day Students: One Hundred Thousand Naira (N100,000)
- Boarding Students: One Hundred and Fifty Thousand Naira (N150,000)

Please note that the registration deposit is non-refundable and encompasses the total sum of the school fees.

Please also note that {SCHOOL_NAME} is a Cambridge-certified school and is internationally recognized by several bodies. Consequently, all Grade 9 students are required to sit for the following examinations:
- Lower Secondary Checkpoint
- NECO/BECE
- ERC/BECE

Congratulations on this achievement. We look forward to partnering with you and your family, and we assure you of our commitment to nurturing your child/ward into a well-rounded young adult.

Please accept our best wishes.`;

const DEFAULT_ADMISSION_BODY = `LABEL: ACADEMIC SESSION: {SESSION}
LABEL: TERM: {TERM}
TITLE: PROVISIONAL ADMISSION
LABEL: Admission No.: {ADMISSION_NO}

Dear Parent/Guardian,
Calvary greetings to you in the name of our Lord Jesus Christ.

Following your application to our prestigious school and your acceptance of our offer of admission, we are pleased to grant your child/ward, {FULL_NAME}, provisional admission into {CLASS}.

This admission is subject to a three (3) academic term probation period, during which we will assess the student's ability to align with the shared expectations between the school and the home, as expressed in Amos 3:3. As a faith-based institution, we emphasize the consistent demonstration of positive character in line with Biblical values.

Registration and placement of new students will commence immediately. As part of the admission requirements, you will be required to review and sign the school's Disciplinary Code of Conduct.

You are expected to pay the school fees in full in accordance with the approved fee schedule for the {TERM} of the {SESSION} academic session. Kindly note that, as the fees are significantly subsidized by the church, all payments must be made promptly on or before the resumption date of each term.

Kindly complete all required documentation and follow the school resumption instructions as communicated by the Admissions Office.

Welcome to {SCHOOL_NAME}. We look forward to partnering with you in nurturing your child/ward.

Please accept our congratulations once again.`;

function clean(value) {
  return String(value ?? '').trim();
}

function pick(row, names, fallback = '') {
  for (const name of names) {
    if (row && row[name] !== undefined && row[name] !== null && clean(row[name])) return row[name];
  }
  return fallback;
}

function stripMarkup(value) {
  return clean(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7e\n]/g, ' ');
}

function displayStatus(value) {
  const status = clean(value).toLowerCase();
  if (['passed', 'admitted'].includes(status)) return 'Admitted';
  if (['failed', 'not admitted'].includes(status)) return 'Not Admitted';
  if (status === 'pending') return 'Pending';
  return clean(value);
}

function resultRemark(value) {
  const status = clean(value).toLowerCase();
  if (['passed', 'admitted'].includes(status)) return 'Congratulations. You have been offered admission.';
  if (status === 'pending') return 'Your result is still under review. Please await further communication.';
  return 'Thank you for participating. You were not admitted at this time.';
}

function renderTemplate(template, context) {
  let rendered = String(template || '');
  const replacements = {
    '{FULL_NAME}': context.name,
    '{FIRST_NAME}': context.name.split(/\s+/)[0] || 'Applicant',
    '{CLASS}': context.className,
    '{SESSION}': context.session,
    '{TERM}': context.term,
    '{ADMISSION_NO}': context.admissionNo,
    '{PERCENTAGE}': context.percentage,
    '{STATUS}': context.status,
    '{APPLICATION_REFERENCE}': context.reference,
    '{SCHOOL_NAME}': context.schoolName,
    '{SCHOOL_ADDRESS}': context.schoolAddress,
    '{DATE}': context.date
  };
  Object.entries(replacements).forEach(([key, value]) => { rendered = rendered.split(key).join(clean(value)); });
  return clean(rendered)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(?!\/?b\b)[^>]+>/gi, '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/•/g, '-');
}

function wrapText(text, font, size, maxWidth) {
  const lines = [];
  String(text || '').split('\n').forEach((sourceLine) => {
    if (!sourceLine.trim()) {
      lines.push('');
      return;
    }
    const words = sourceLine.trim().split(/\s+/);
    let line = '';
    words.forEach((word) => {
      const candidate = line ? `${line} ${word}` : word;
      if (!line || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    });
    if (line) lines.push(line);
  });
  return lines;
}

function wrapRichText(markup, regular, bold, size, maxWidth) {
  const words = [];
  let boldActive = false;
  String(markup || '').split(/(<\/?b>)/i).forEach((segment) => {
    if (/^<b>$/i.test(segment)) {
      boldActive = true;
    } else if (/^<\/b>$/i.test(segment)) {
      boldActive = false;
    } else {
      stripMarkup(segment).split(/\s+/).filter(Boolean).forEach((word) => words.push({ word, bold: boldActive }));
    }
  });
  const lines = [];
  let line = [];
  let lineWidth = 0;
  words.forEach((item) => {
    const font = item.bold ? bold : regular;
    const text = line.length ? ` ${item.word}` : item.word;
    const width = font.widthOfTextAtSize(text, size);
    if (line.length && lineWidth + width > maxWidth) {
      lines.push(line);
      line = [{ ...item, text: item.word }];
      lineWidth = font.widthOfTextAtSize(item.word, size);
    } else {
      line.push({ ...item, text });
      lineWidth += width;
    }
  });
  if (line.length) lines.push(line);
  return lines.length ? lines : [[]];
}

async function embedDataImage(pdf, dataUrl) {
  const value = clean(dataUrl);
  const match = value.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
  if (!match) return null;
  try {
    return match[1].toLowerCase() === 'png' ? await pdf.embedPng(value) : await pdf.embedJpg(value);
  } catch (_error) {
    return null;
  }
}

function centeredX(font, text, size, pageWidth = LETTER[0]) {
  return Math.max(36, (pageWidth - font.widthOfTextAtSize(text, size)) / 2);
}

function drawQrCode(page, value, x, y, size) {
  const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
  const margin = 2;
  const moduleSize = size / (qr.modules.size + (margin * 2));
  page.drawRectangle({ x, y, width: size, height: size, color: rgb(1, 1, 1) });
  for (let row = 0; row < qr.modules.size; row += 1) {
    for (let column = 0; column < qr.modules.size; column += 1) {
      if (!qr.modules.get(row, column)) continue;
      page.drawRectangle({
        x: x + ((column + margin) * moduleSize),
        y: y + size - ((row + margin + 1) * moduleSize),
        width: moduleSize + 0.05,
        height: moduleSize + 0.05,
        color: rgb(0, 0, 0)
      });
    }
  }
}

async function createAssets(profile) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedDataImage(pdf, profile.DocumentLogoDataUrl || profile.WebLogoDataUrl);
  const signature = await embedDataImage(pdf, profile.DocumentSignatureDataUrl);
  return { pdf, regular, bold, logo, signature };
}

function drawWatermark(page, logo) {
  if (!logo) return;
  const scaled = logo.scaleToFit(360, 360);
  page.drawImage(logo, {
    x: (LETTER[0] - scaled.width) / 2,
    y: (LETTER[1] - scaled.height) / 2 - 10,
    width: scaled.width,
    height: scaled.height,
    opacity: 0.07
  });
}

function drawLetterBackground(page, assets, profile, title = '') {
  const { regular, bold, logo } = assets;
  page.drawRectangle({ x: 28, y: 28, width: 556, height: 736, borderColor: BLUE, borderWidth: 1.2 });
  drawWatermark(page, logo);
  if (logo) {
    const scaled = logo.scaleToFit(58, 58);
    page.drawImage(logo, { x: 48, y: 704, width: scaled.width, height: scaled.height });
  }
  const schoolName = stripMarkup(profile.SchoolName || 'School').toUpperCase();
  page.drawText(schoolName, { x: centeredX(bold, schoolName, 16), y: 745, size: 16, font: bold, color: BLUE });
  const address = stripMarkup(profile.SchoolAddress);
  if (address) page.drawText(address, { x: centeredX(regular, address, 9), y: 729, size: 9, font: regular, color: MUTED });
  if (title) page.drawText(title, { x: centeredX(bold, title, 14), y: 686, size: 14, font: bold, color: TEXT });
}

function drawSignature(page, assets, name, title, y) {
  const { regular, bold, signature } = assets;
  page.drawText('Yours sincerely,', { x: 58, y, size: 10, font: regular, color: TEXT });
  let nextY = y - 52;
  if (signature) {
    const scaled = signature.scaleToFit(120, 46);
    page.drawImage(signature, { x: 58, y: y - 48, width: scaled.width, height: scaled.height });
    nextY = y - 64;
  }
  page.drawLine({ start: { x: 58, y: nextY + 8 }, end: { x: 220, y: nextY + 8 }, thickness: 0.8, color: TEXT });
  if (name) page.drawText(stripMarkup(name), { x: 58, y: nextY - 6, size: 9, font: bold, color: TEXT });
  if (title) page.drawText(stripMarkup(title), { x: 58, y: nextY - 20, size: 9, font: regular, color: TEXT });
}

function contextFor(profile, application, issuedAt) {
  const name = stripMarkup(pick(application, ['ApplicantName', 'DisplayName', 'Name'])) || 'Applicant';
  return {
    name,
    className: stripMarkup(pick(application, ['ClassAdmitted', 'ClassApplyingFor', 'ClassAppliedFor', 'Class'])) || '',
    session: stripMarkup(pick(application, ['AcademicSession'])) || '',
    term: stripMarkup(pick(application, ['Term'])) || '',
    admissionNo: stripMarkup(pick(application, ['AdmissionNo', 'AdmissionNumber'])) || '',
    reference: stripMarkup(pick(application, ['ApplicationReference', 'ApplicationID', '__id'])) || '',
    percentage: stripMarkup(pick(application, ['ResultPercentage', 'Percentage'])) || '',
    status: displayStatus(pick(application, ['ResultStatus', 'Status'])),
    schoolName: stripMarkup(profile.SchoolName || 'School'),
    schoolAddress: stripMarkup(profile.SchoolAddress),
    date: new Date(issuedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(/ /g, '-')
  };
}

async function resultPdf(profile, application, issuedAt) {
  const assets = await createAssets(profile);
  const { pdf, regular, bold, logo, signature } = assets;
  const page = pdf.addPage(LETTER);
  drawWatermark(page, logo);
  if (logo) {
    const scaled = logo.scaleToFit(65, 65);
    page.drawImage(logo, { x: 50, y: 705, width: scaled.width, height: scaled.height });
  }
  const context = contextFor(profile, application, issuedAt);
  page.drawText(context.schoolName.toUpperCase(), { x: centeredX(bold, context.schoolName.toUpperCase(), 16), y: 760, size: 16, font: bold, color: TEXT });
  if (context.schoolAddress) page.drawText(context.schoolAddress, { x: centeredX(regular, context.schoolAddress, 10), y: 742, size: 10, font: regular, color: TEXT });
  const heading = 'OFFICIAL ENTRANCE EXAMINATION RESULT SLIP';
  page.drawText(heading, { x: centeredX(bold, heading, 14), y: 675, size: 14, font: bold, color: TEXT });
  page.drawLine({ start: { x: 60, y: 658 }, end: { x: 552, y: 658 }, thickness: 3, color: TEXT });
  const score = context.percentage ? `${context.percentage.replace(/%$/, '')}%` : '';
  [['Candidate Name:', context.name, 620], ['Score:', score || 'Not recorded', 590], ['Status:', context.status, 560]].forEach(([label, value, y]) => {
    page.drawText(label, { x: 70, y, size: 12, font: bold, color: TEXT });
    page.drawText(value, { x: 200, y, size: 12, font: regular, color: TEXT });
  });
  drawQrCode(page, `Name: ${context.name}, Score: ${score}, Status: ${context.status}`, 400, 560, 100);
  page.drawText('Result verification QR', { x: 390, y: 545, size: 8, font: regular, color: TEXT });
  page.drawText('Remark:', { x: 70, y: 505, size: 12, font: bold, color: TEXT });
  let y = 505;
  wrapText(resultRemark(context.status), regular, 12, 340).forEach((line) => {
    page.drawText(line, { x: 140, y, size: 12, font: regular, color: TEXT });
    y -= 14;
  });
  y -= 20;
  page.drawText('Next Step:', { x: 70, y, size: 12, font: bold, color: TEXT });
  y -= 20;
  const nextStep = stripMarkup(pick(application, ['ResultNextStep', 'NextStep'])) || '[No Next Step Provided]';
  wrapText(nextStep, regular, 11, 460).forEach((line) => {
    page.drawText(line, { x: 70, y, size: 11, font: regular, color: TEXT });
    y -= 14;
  });
  y -= 18;
  const resultTitle = stripMarkup(profile.ResultSignatoryTitle || profile.SchoolSignatoryTitle);
  page.drawText(`Issued by: ${context.schoolName}${resultTitle ? ` ${resultTitle}` : ''}`, { x: 70, y, size: 10, font: regular, color: TEXT });
  if (signature) {
    const scaled = signature.scaleToFit(120, 50);
    page.drawImage(signature, { x: 380, y: y - 75, width: scaled.width, height: scaled.height });
  }
  page.drawLine({ start: { x: 370, y: y - 80 }, end: { x: 520, y: y - 80 }, thickness: 0.8, color: TEXT });
  const signatoryName = stripMarkup(profile.ResultSignatoryName || profile.SchoolSignatoryName);
  if (signatoryName) page.drawText(signatoryName, { x: 370, y: y - 95, size: 9, font: bold, color: TEXT });
  if (resultTitle) page.drawText(resultTitle, { x: 370, y: y - 109, size: 9, font: regular, color: TEXT });
  return pdf.save();
}

async function letterPdf(profile, application, documentType, issuedAt) {
  const assets = await createAssets(profile);
  const { pdf, regular, bold } = assets;
  const context = contextFor(profile, application, issuedAt);
  const isOffer = documentType === 'offer';
  const headerTitle = isOffer ? 'OFFER OF ADMISSION' : '';
  const configuredBody = isOffer
    ? profile.OfferDocumentBodyTemplate || application.OfferBodyTemplate || application.OfferFullBody
    : profile.AdmissionDocumentBodyTemplate || application.AdmissionLetterBodyTemplate || application.AdmissionLetterFullBody;
  const body = renderTemplate(configuredBody || (isOffer ? DEFAULT_OFFER_BODY : DEFAULT_ADMISSION_BODY), context);
  let page = pdf.addPage(LETTER);
  drawLetterBackground(page, assets, profile, headerTitle);
  let y = headerTitle ? 654 : 688;
  const left = 58;
  const maxWidth = 496;

  const addPage = () => {
    page = pdf.addPage(LETTER);
    drawLetterBackground(page, assets, profile, '');
    y = 690;
  };

  const bodyBlocks = [];
  let paragraphLines = [];
  const flushParagraph = () => {
    if (paragraphLines.length) bodyBlocks.push(paragraphLines.join(' '));
    paragraphLines = [];
  };
  body.split('\n').forEach((line) => {
    const raw = line.trim();
    if (!raw) {
      flushParagraph();
    } else if (/^(?:TITLE|LABEL):/i.test(raw) || /^-\s+/.test(raw) || /^(?:Dear Parent\/Guardian|Calvary greetings)/i.test(raw)) {
      flushParagraph();
      bodyBlocks.push(raw);
    } else {
      paragraphLines.push(raw);
    }
  });
  flushParagraph();

  bodyBlocks.forEach((paragraph) => {
    const raw = paragraph.trim();
    if (!raw) return;
    const plain = stripMarkup(raw);
    const title = plain.startsWith('TITLE:');
    const label = plain.startsWith('LABEL:');
    const text = raw.replace(/^(?:TITLE|LABEL):\s*/i, '');
    const plainText = stripMarkup(text);
    const font = title || label ? bold : regular;
    const size = title ? 13 : label ? 10 : 10.5;
    const lines = title || label
      ? wrapText(plainText, font, size, maxWidth)
      : wrapRichText(text, regular, bold, size, maxWidth);
    const required = lines.length * 15 + 10;
    if (y - required < 145) addPage();
    lines.forEach((line) => {
      const x = title ? centeredX(font, line, size) : left;
      if (title || label) {
        page.drawText(line, { x, y, size, font, color: TEXT });
      } else {
        let cursorX = x;
        line.forEach((token) => {
          const tokenFont = token.bold ? bold : regular;
          page.drawText(token.text, { x: cursorX, y, size, font: tokenFont, color: TEXT });
          cursorX += tokenFont.widthOfTextAtSize(token.text, size);
        });
      }
      y -= 15;
    });
    y -= title ? 10 : 8;
  });

  if (y < 155) addPage();
  drawSignature(
    page,
    assets,
    isOffer ? profile.OfferSignatoryName || profile.SchoolSignatoryName : profile.AdmissionSignatoryName || profile.SchoolSignatoryName,
    isOffer ? profile.OfferSignatoryTitle || profile.SchoolSignatoryTitle : profile.AdmissionSignatoryTitle || profile.SchoolSignatoryTitle,
    y - 4
  );

  if (isOffer) {
    page = pdf.addPage(LETTER);
    drawLetterBackground(page, assets, profile, '');
    const title = 'ACCEPTANCE OF OFFER';
    page.drawText(title, { x: centeredX(bold, title, 14), y: 700, size: 14, font: bold, color: TEXT });
    [
      'I, ______________________________________________________________________',
      'the Parent/Guardian of _____________________________________________________,',
      'hereby accept the offer of admission for my child/ward.',
      '',
      "I pledge to abide by the school's rules and regulations as outlined in the admission form, duly completed and signed by both parents/guardians.",
      '',
      'Signature: ___________________________',
      'Date: _______________________________'
    ].forEach((line, index) => {
      if (line) wrapText(line, regular, 10, 480).forEach((wrapped, lineIndex) => {
        page.drawText(wrapped, { x: 65, y: 650 - (index * 32) - (lineIndex * 14), size: 10, font: regular, color: TEXT });
      });
    });
  }
  return pdf.save();
}

export async function createAdmissionPdf(profile, application, documentType, issuedAt = new Date().toISOString()) {
  return documentType === 'result'
    ? resultPdf(profile, application, issuedAt)
    : letterPdf(profile, application, documentType, issuedAt);
}
