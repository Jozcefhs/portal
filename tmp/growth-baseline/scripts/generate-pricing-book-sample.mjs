import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { createPricingBookPdf } from '../functions/lib/pricing-book-pdf.js';
import { normalizeSubscriptionPlanCatalog } from '../functions/lib/subscription-plans.js';

const outputPath = resolve(process.argv[2] || '../output/pdf/Dynamax_Pricing_Book_Sample.pdf');
const catalog = normalizeSubscriptionPlanCatalog({
  Currency: 'NGN',
  Plans: {
    Starter: { MonthlyAmount: 10000, YearlyAmount: 100000 },
    Standard: { MonthlyAmount: 20000, YearlyAmount: 200000 },
    Professional: { MonthlyAmount: 40000, YearlyAmount: 400000 },
    Enterprise: { MonthlyAmount: 80000, YearlyAmount: 800000, UserLimit: 250 }
  }
});

const bytes = await createPricingBookPdf(catalog, {
  edition: 'school',
  billingCycle: 'monthly'
});
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, bytes);
process.stdout.write(`${outputPath}\n`);

