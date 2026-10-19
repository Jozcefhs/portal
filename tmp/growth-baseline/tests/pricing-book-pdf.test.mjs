import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { PDFDocument } from 'pdf-lib';

import { createPricingBookPdf } from '../functions/lib/pricing-book-pdf.js';
import { normalizeSubscriptionPlanCatalog } from '../functions/lib/subscription-plans.js';

test('pricing book produces a valid two-page landscape PDF', async () => {
  const catalog = normalizeSubscriptionPlanCatalog({
    Currency: 'NGN',
    Plans: {
      Starter: { MonthlyAmount: 10000, YearlyAmount: 100000 },
      Standard: { MonthlyAmount: 20000, YearlyAmount: 200000 },
      Professional: { MonthlyAmount: 40000, YearlyAmount: 400000 },
      Enterprise: { MonthlyAmount: 80000, YearlyAmount: 800000, UserLimit: 500 }
    }
  });
  const bytes = await createPricingBookPdf(catalog, {
    edition: 'faith',
    billingCycle: 'yearly',
    generatedAt: '2026-08-06T12:00:00.000Z'
  });
  assert.ok(bytes.byteLength > 5000);
  assert.equal(new TextDecoder('latin1').decode(bytes.slice(0, 8)), '%PDF-1.7');
  const parsed = await PDFDocument.load(bytes);
  assert.equal(parsed.getPageCount(), 2);
  parsed.getPages().forEach((page) => {
    const { width, height } = page.getSize();
    assert.ok(width > height);
  });
});

test('pricing cards use neutral surfaces without plan-specific cover colours', async () => {
  const [css, registration] = await Promise.all([
    readFile(new URL('../css/style.css', import.meta.url), 'utf8'),
    readFile(new URL('../js/register-organization.js', import.meta.url), 'utf8')
  ]);
  assert.match(css, /\.plan-choice-card \{[^}]*background:\s*#fff/);
  assert.match(css, /\.plan-choice-card::before, \.plan-choice-card::after \{ content: none; \}/);
  assert.match(css, /\.plan-comparison-column \{[^}]*background:\s*#fff/);
  assert.doesNotMatch(registration, /planBookThemes|--plan-sheet|--plan-cover|--plan-strip|--plan-accent/);
});
