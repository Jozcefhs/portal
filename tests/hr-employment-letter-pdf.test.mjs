import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { createEmploymentLetterPdf } from '../functions/lib/hr-employment-letter-pdf.js';

test('employment PDF handles long employer, employee, salary and policy text over multiple complete pages', async () => {
  const terms = { LetterDate: '2026-11-10', StartDate: '2026-12-01', Position: 'Senior Operations Officer', Department: 'Operations', EmploymentType: 'Permanent',
    WorkingHours: 'Monday to Friday', Probation: 'As agreed', NoticePeriod: 'As agreed', Benefits: 'As agreed', Terms: 'A long policy paragraph containing readable employment terms. '.repeat(80) };
  const bytes = await createEmploymentLetterPdf({ SchoolAddress: 'A detailed employer address '.repeat(8) }, {
    LetterId: 'EMP-TEST', EmployerName: 'Example International Education and Community Services Organisation '.repeat(2),
    EmployeeName: 'Example Employee With A Long Recorded Name', RecipientEmail: 'employee@example.org', BranchId: 'north',
    IssuerName: 'Example Officer', IssuerTitle: 'Human Resources Manager', Terms: terms,
    Salary: { Earnings: Array.from({ length: 35 }, (_, index) => ({ Name: `Salary component ${index + 1} with a long description requiring a wrapped row`, Amount: 1000 })), Deductions: [], GrossPay: 35000 }
  });
  assert.match(new TextDecoder().decode(bytes.slice(0, 8)), /%PDF-/);
  const document = await PDFDocument.load(bytes);
  assert.ok(document.getPageCount() >= 3); assert.ok(document.getPageCount() <= 8);
  for (const page of document.getPages()) assert.deepEqual([page.getWidth(), page.getHeight()], [595, 842]);
  assert.ok(bytes.length < 500000);
});

test('invalid configured signature is not silently omitted from an employment PDF', async () => {
  await assert.rejects(createEmploymentLetterPdf({}, {}, { signatureDataUrl: 'data:image/png;base64,AAAA' }), /signature could not be added/);
});
