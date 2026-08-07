import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

import {
  normalizeBillingCycle,
  publicSubscriptionPlanCatalog
} from './subscription-plans.js';

const A4_LANDSCAPE = [841.89, 595.28];
const PAGE_BACKGROUND = rgb(0.965, 0.978, 1);
const NAVY = rgb(0.035, 0.18, 0.36);
const BLUE = rgb(0.09, 0.41, 0.88);
const TEXT = rgb(0.07, 0.13, 0.22);
const MUTED = rgb(0.32, 0.4, 0.5);
const WHITE = rgb(1, 1, 1);
const BORDER = rgb(0.82, 0.87, 0.93);

const PLAN_THEMES = Object.freeze({
  Free: { accent: rgb(0.06, 0.56, 0.66), pale: rgb(0.91, 0.99, 1) },
  Starter: { accent: rgb(0.18, 0.44, 0.95), pale: rgb(0.93, 0.96, 1) },
  Standard: { accent: rgb(0.12, 0.58, 0.32), pale: rgb(0.92, 0.98, 0.93) },
  Professional: { accent: rgb(0.61, 0.19, 0.82), pale: rgb(0.99, 0.94, 1) },
  Enterprise: { accent: rgb(0.94, 0.48, 0.12), pale: rgb(1, 0.96, 0.88) }
});

function clean(value) {
  return String(value ?? '')
    .replace(/[^\x20-\x7e]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeEdition(value) {
  const edition = clean(value).toLowerCase();
  return ['faith', 'organization'].includes(edition) ? edition : 'school';
}

function editionLabel(value) {
  if (value === 'faith') return 'Church and religious organisations';
  if (value === 'organization') return 'General organisations';
  return 'Schools';
}

function formatPrice(value, currency) {
  const amount = Number(value || 0);
  if (!(amount > 0)) return 'Price to be confirmed';
  return `${clean(currency || 'NGN').toUpperCase()} ${amount.toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatPlanPrice(plan, value, currency) {
  return plan?.Name === 'Free' ? 'Free for 7 days' : formatPrice(value, currency);
}

function wrapText(text, font, size, maxWidth) {
  const words = clean(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawWrapped(page, text, { x, y, width, font, size, color = TEXT, lineHeight = size * 1.3, maxLines = 99 }) {
  const lines = wrapText(text, font, size, width).slice(0, maxLines);
  lines.forEach((line, index) => page.drawText(line, {
    x,
    y: y - (index * lineHeight),
    size,
    font,
    color
  }));
  return y - (lines.length * lineHeight);
}

function drawPageBackground(page) {
  page.drawRectangle({ x: 0, y: 0, width: A4_LANDSCAPE[0], height: A4_LANDSCAPE[1], color: PAGE_BACKGROUND });
}

function drawFooter(page, regular, pageNumber, generatedAt) {
  const date = new Date(generatedAt).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC'
  });
  page.drawLine({ start: { x: 32, y: 35 }, end: { x: 810, y: 35 }, thickness: 0.7, color: BORDER });
  page.drawText(`Dynamax Pricing Book | Generated ${clean(date)}`, { x: 32, y: 19, size: 8, font: regular, color: MUTED });
  page.drawText(`Page ${pageNumber}`, { x: 778, y: 19, size: 8, font: regular, color: MUTED });
}

function userLabel(plan) {
  const limit = Number(plan.UserLimit || 0).toLocaleString('en-NG');
  return plan.Name === 'Enterprise' ? `Up to ${limit} users or custom` : `${limit} active users`;
}

function drawOverviewPage(pdf, fonts, catalog, edition, cycle, generatedAt) {
  const page = pdf.addPage(A4_LANDSCAPE);
  const { regular, bold } = fonts;
  drawPageBackground(page);
  page.drawRectangle({ x: 0, y: 493, width: A4_LANDSCAPE[0], height: 102, color: NAVY });
  page.drawText('DYNAMAX', { x: 34, y: 559, size: 10, font: bold, color: rgb(0.36, 0.91, 0.76) });
  page.drawText('Pricing Book', { x: 34, y: 524, size: 28, font: bold, color: WHITE });
  page.drawText(`A clear comparison for ${editionLabel(edition)}`, { x: 34, y: 505, size: 11, font: regular, color: rgb(0.8, 0.88, 0.97) });
  page.drawRectangle({ x: 650, y: 519, width: 157, height: 38, borderRadius: 12, color: BLUE });
  page.drawText(`${cycle === 'yearly' ? 'Yearly' : 'Monthly'} billing`, { x: 674, y: 536, size: 12, font: bold, color: WHITE });

  const plans = catalog.Plans;
  const margin = 32;
  const gap = 10;
  const cardWidth = (A4_LANDSCAPE[0] - (margin * 2) - (gap * 4)) / 5;
  const cardY = 58;
  const cardHeight = 416;
  plans.forEach((plan, index) => {
    const theme = PLAN_THEMES[plan.Name] || PLAN_THEMES.Starter;
    const x = margin + (index * (cardWidth + gap));
    page.drawRectangle({
      x,
      y: cardY,
      width: cardWidth,
      height: cardHeight,
      borderRadius: 14,
      color: theme.pale,
      borderColor: theme.accent,
      borderWidth: plan.Name === 'Professional' ? 2 : 1
    });
    page.drawRectangle({ x, y: cardY, width: 9, height: cardHeight, color: theme.accent });
    if (plan.Name === 'Professional') {
      page.drawRectangle({ x: x + cardWidth - 91, y: cardY + cardHeight - 27, width: 78, height: 18, borderRadius: 8, color: theme.accent });
      page.drawText('RECOMMENDED', { x: x + cardWidth - 84, y: cardY + cardHeight - 21, size: 7, font: bold, color: WHITE });
    }
    page.drawText(clean(plan.Name), { x: x + 19, y: cardY + cardHeight - 38, size: 17, font: bold, color: TEXT });
    page.drawText(userLabel(plan), { x: x + 19, y: cardY + cardHeight - 58, size: 9, font: regular, color: MUTED });
    let y = drawWrapped(page, plan.Summary, {
      x: x + 19, y: cardY + cardHeight - 83, width: cardWidth - 35, font: regular, size: 9.5, color: TEXT, lineHeight: 12, maxLines: 3
    });
    const amount = cycle === 'yearly' ? plan.YearlyAmount : plan.MonthlyAmount;
    y -= 10;
    y = drawWrapped(page, formatPlanPrice(plan, amount, catalog.Currency), {
      x: x + 19, y, width: cardWidth - 35, font: bold, size: 13, color: theme.accent, lineHeight: 15, maxLines: 2
    });
    page.drawText(plan.Name === 'Free' ? 'one-time trial' : cycle === 'yearly' ? 'per year' : 'per month', { x: x + 19, y: y - 2, size: 8, font: regular, color: MUTED });
    y -= 28;
    page.drawText('Included highlights', { x: x + 19, y, size: 9, font: bold, color: TEXT });
    y -= 18;
    const features = plan.FeaturesByEdition?.[edition] || [];
    features.slice(0, 6).forEach((feature) => {
      page.drawCircle({ x: x + 22, y: y + 3, size: 2.5, color: theme.accent });
      y = drawWrapped(page, feature, {
        x: x + 31, y: y + 7, width: cardWidth - 49, font: regular, size: 8.5, color: TEXT, lineHeight: 11, maxLines: 3
      }) - 4;
    });
    if (plan.Active === false) {
      page.drawRectangle({ x: x + 19, y: cardY + 18, width: cardWidth - 38, height: 24, borderRadius: 8, color: MUTED });
      page.drawText('CURRENTLY UNAVAILABLE', { x: x + 36, y: cardY + 27, size: 8, font: bold, color: WHITE });
    }
  });
  drawFooter(page, regular, 1, generatedAt);
}

function drawComparisonPage(pdf, fonts, catalog, edition, cycle, generatedAt) {
  const page = pdf.addPage(A4_LANDSCAPE);
  const { regular, bold } = fonts;
  drawPageBackground(page);
  page.drawRectangle({ x: 0, y: 512, width: A4_LANDSCAPE[0], height: 83, color: NAVY });
  page.drawText('Plan feature comparison', { x: 34, y: 554, size: 23, font: bold, color: WHITE });
  page.drawText(`${editionLabel(edition)} | ${cycle === 'yearly' ? 'Yearly' : 'Monthly'} prices`, { x: 34, y: 530, size: 10, font: regular, color: rgb(0.8, 0.88, 0.97) });

  const margin = 32;
  const gap = 10;
  const columnWidth = (A4_LANDSCAPE[0] - (margin * 2) - (gap * 4)) / 5;
  catalog.Plans.forEach((plan, index) => {
    const theme = PLAN_THEMES[plan.Name] || PLAN_THEMES.Starter;
    const x = margin + (index * (columnWidth + gap));
    page.drawRectangle({ x, y: 58, width: columnWidth, height: 435, borderRadius: 12, color: WHITE, borderColor: BORDER, borderWidth: 1 });
    page.drawRectangle({ x, y: 440, width: columnWidth, height: 53, borderRadius: 12, color: theme.accent });
    page.drawText(clean(plan.Name), { x: x + 13, y: 469, size: 14, font: bold, color: WHITE });
    const amount = cycle === 'yearly' ? plan.YearlyAmount : plan.MonthlyAmount;
    drawWrapped(page, formatPlanPrice(plan, amount, catalog.Currency), {
      x: x + 13, y: 451, width: columnWidth - 26, font: regular, size: 8.5, color: WHITE, lineHeight: 10, maxLines: 1
    });
    page.drawText(userLabel(plan), { x: x + 13, y: 421, size: 8.5, font: bold, color: TEXT });
    let y = 394;
    const features = plan.FeaturesByEdition?.[edition] || [];
    features.forEach((feature) => {
      page.drawCircle({ x: x + 16, y: y + 3, size: 2.4, color: theme.accent });
      y = drawWrapped(page, feature, {
        x: x + 25, y: y + 7, width: columnWidth - 39, font: regular, size: 9, color: TEXT, lineHeight: 12, maxLines: 3
      }) - 6;
    });
  });
  page.drawText('External billable services, onboarding work and custom integrations may be priced separately where applicable.', {
    x: 34, y: 46, size: 8, font: regular, color: MUTED
  });
  drawFooter(page, regular, 2, generatedAt);
}

export async function createPricingBookPdf(catalogValue, options = {}) {
  const catalog = publicSubscriptionPlanCatalog(catalogValue || {});
  const edition = normalizeEdition(options.edition);
  const cycle = normalizeBillingCycle(options.billingCycle);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const pdf = await PDFDocument.create();
  pdf.setTitle('Dynamax Pricing Book');
  pdf.setAuthor('Dynamax');
  pdf.setSubject(`${editionLabel(edition)} subscription plan comparison`);
  pdf.setCreationDate(new Date(generatedAt));
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold)
  };
  drawOverviewPage(pdf, fonts, catalog, edition, cycle, generatedAt);
  drawComparisonPage(pdf, fonts, catalog, edition, cycle, generatedAt);
  return pdf.save();
}
