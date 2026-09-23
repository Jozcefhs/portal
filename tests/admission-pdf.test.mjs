import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { createAdmissionPdf } from '../functions/lib/admission-pdf.js';

const profile = {
  SchoolName: 'Test School',
  SchoolAddress: '1 Test Road',
  ResultSignatoryName: 'Examination Officer',
  ResultSignatoryTitle: 'Examinations Officer',
  OfferSignatoryName: 'Principal',
  OfferSignatoryTitle: 'Principal',
  AdmissionSignatoryName: 'Director',
  AdmissionSignatoryTitle: 'Director'
};
const application = {
  ApplicantName: 'Ada Student',
  ApplicationReference: 'APP-001',
  AdmissionNo: 'ADM-001',
  ClassApplyingFor: 'JSS 1',
  AcademicSession: '2026/2027',
  Term: 'First Term',
  ResultStatus: 'Admitted',
  ResultPercentage: '83.3',
  ResultNextStep: 'Proceed to the Admissions Office.'
};

test('custom admission documents are valid PDFs with the approved page structure', async () => {
  for (const [type, expectedPages] of [['result', 1], ['offer', 2], ['admission', 1]]) {
    const bytes = await createAdmissionPdf(profile, application, type, '2026-07-23T00:00:00.000Z');
    assert.equal(String.fromCharCode(...bytes.slice(0, 5)), '%PDF-');
    const parsed = await PDFDocument.load(bytes);
    assert.equal(parsed.getPageCount(), expectedPages, `${type} PDF page count`);
  }
});

test('completed probation re-sit result produces a valid result PDF', async () => {
  const bytes = await createAdmissionPdf(profile, {
    ...application,
    ResultStatus: 'Admitted',
    ProbationResult: 'Passed',
    ProbationResitPercentage: '74.5',
    ProbationResitDate: '2026-09-23'
  }, 'result', '2026-09-23T00:00:00.000Z');
  const parsed = await PDFDocument.load(bytes);
  assert.equal(parsed.getPageCount(), 1);
});
