import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  applicantAgeOn,
  evaluateAdmissionAge,
  normalizeMinimumAdmissionAge
} from '../functions/lib/admission-age.js';

test('minimum admission age accepts only whole configured ages', () => {
  assert.equal(normalizeMinimumAdmissionAge('12'), 12);
  assert.equal(normalizeMinimumAdmissionAge(0), 0);
  assert.equal(normalizeMinimumAdmissionAge(''), null);
  assert.equal(normalizeMinimumAdmissionAge('12.5'), null);
  assert.equal(normalizeMinimumAdmissionAge('121'), null);
});

test('applicant age uses the birthday rather than only subtracting years', () => {
  assert.equal(applicantAgeOn('2014-08-03', '2026-08-02'), 11);
  assert.equal(applicantAgeOn('2014-08-02', '2026-08-02'), 12);
  assert.equal(applicantAgeOn('2027-01-01', '2026-08-02'), null);
});

test('class-specific admission age blocks an underage application', () => {
  const result = evaluateAdmissionAge(
    { ClassName: 'JSS 1 / Grade 7', MinimumAge: 12 },
    '2015-01-01',
    '2026-08-02'
  );
  assert.equal(result.ok, false);
  assert.match(result.message, /at least 12 years old/);
  assert.match(result.message, /JSS 1 \/ Grade 7/);
});

test('desktop setting is persisted and enforced in browser and server paths', async () => {
  const [backend, submit, application, publicClasses, applicationHtml, buyFormHtml] = await Promise.all([
    readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/submit-application.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/application.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/admission-classes.js', import.meta.url), 'utf8'),
    readFile(new URL('../application.html', import.meta.url), 'utf8'),
    readFile(new URL('../buy-form.html', import.meta.url), 'utf8')
  ]);
  assert.match(backend, /MinimumAge: minimumAge === null \? '' : minimumAge/);
  assert.match(submit, /assertAdmissionAgeRequirement/);
  assert.match(submit, /evaluateAdmissionAge/);
  assert.match(application, /minimum age \$\{minimumAge\}/);
  assert.match(application, /validateAdmissionAge/);
  assert.match(application, /cache: false/);
  assert.match(application, /force: true/);
  assert.match(publicClasses, /'Cache-Control': 'no-store'/);
  assert.match(applicationHtml, /js\/application\.js\?v=20260802-admission-minimum-age/);
  assert.match(buyFormHtml, /js\/buy-form\.js\?v=20260809-direct-transfer/);
});
