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

test('pricing cards keep their content above decorative cover layers', async () => {
  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.plan-choice-card::before[^}]*z-index:\s*0[^}]*pointer-events:\s*none/);
  assert.match(css, /\.plan-choice-card::after[^}]*z-index:\s*0[^}]*pointer-events:\s*none/);
  assert.match(css, /\.plan-choice-select\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*1/);
  assert.match(css, /\.plan-choice-main\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*1/);
});
