import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { resolveOrganizationConfig } from '../functions/lib/organization-config.js';
import { mergedProfileText } from '../functions/lib/profile-settings-update.js';

const files = ['functions/api/settings.js', 'functions/api/backend.js', 'functions/api/submit-application.js',
  'functions/api/verify-form-payment.js', 'functions/lib/organization-config.js', 'js/setup.js', 'setup.html'];
const sources = Object.fromEntries(await Promise.all(files.map(async path => [path, await readFile(new URL(`../${path}`, import.meta.url), 'utf8')])));
const clean = value => String(value ?? '').trim();
function extract(path, name, mocks = {}) {
  const declaration = sources[path].match(new RegExp(`(?:async )?function ${name}\\([^]*?\\r?\\n\\}`));
  assert.ok(declaration, `Find ${name} in ${path}`);
  return vm.runInNewContext(`(${declaration[0]})`, { clean, ...mocks });
}

test('school profile normalizers leave missing/cleared codes blank and preserve explicitly configured codes', () => {
  for (const path of ['functions/api/settings.js', 'functions/api/backend.js']) {
    const normalize = extract(path, 'normalizeSchoolCode');
    for (const value of [undefined, null, '', '  ', '---']) assert.equal(normalize(value), '');
    assert.equal(normalize(' bps-2 '), 'BPS2');
    assert.equal(normalize('DCA'), 'DCA', 'an organisation may still explicitly choose DCA');
  }
});

test('new school settings have no default school code; environment configuration remains authoritative', () => {
  const normalizeSchoolCode = extract('functions/api/settings.js', 'normalizeSchoolCode');
  const defaults = extract('functions/api/settings.js', 'defaultProfile', {
    normalizeSchoolCode, resolveOrganizationConfig,
    requiredDeploymentIdentity: () => ({ edition: 'school', workspaceId: 'school' }),
    documentStorageConfigured: () => false, paystackSecretMode: () => '', emailProviderProfile: () => ({})
  });
  assert.equal(defaults({}).SchoolCode, '');
  assert.equal(defaults({ SCHOOL_CODE: 'BPS' }).SchoolCode, 'BPS');
});

test('partial settings updates preserve the saved code and explicitly submitted blanks clear it', () => {
  const normalize = extract('functions/api/settings.js', 'normalizeSchoolCode');
  assert.match(sources['functions/api/settings.js'], /SchoolCode: normalizeSchoolCode\(mergedProfileText\(existing, incoming, 'SchoolCode'\)\)/);
  assert.equal(normalize(mergedProfileText({ SchoolCode: 'BPS' }, {}, 'SchoolCode')), 'BPS');
  assert.equal(normalize(mergedProfileText({ SchoolCode: 'BPS' }, { SchoolCode: '' }, 'SchoolCode')), '');
});

test('setup displays a blank school code instead of injecting a value or a school-specific placeholder', () => {
  for (const profile of [{}, { SchoolCode: '' }, { SchoolCode: 'BPS' }, { SchoolCode: 'DCA' }]) {
    const fields = new Map(); const stop = new Error('Stop after school-code field');
    const applyProfile = extract('js/setup.js', 'applyProfile', {
      populateBranchOptions: () => {}, populateBranchTerminology: () => {}, applySettingsAccess: () => {},
      setField: (id, value) => { if (id === 'schoolAddress') throw stop; fields.set(id, value); }
    });
    assert.throws(() => applyProfile(profile), error => error === stop);
    assert.equal(fields.get('schoolCode'), profile.SchoolCode || '');
  }
  assert.doesNotMatch(sources['setup.html'], /id="schoolCode"[^>]*(?:value|placeholder)="DCA"/);
  assert.match(sources['setup.html'], /js\/setup\.js\?v=20261003-no-school-code-default/);
});

test('school organisation fallback is generic while saved school/organisation codes remain intact', () => {
  assert.equal(resolveOrganizationConfig({ env: { ORGANISATION_EDITION: 'school' } }).Code, 'ORG');
  assert.equal(resolveOrganizationConfig({ legacyProfile: { SchoolCode: 'BPS' } }).Code, 'BPS');
  assert.equal(resolveOrganizationConfig({ legacyProfile: { SchoolCode: 'DCA' } }).Code, 'DCA');
  assert.equal(resolveOrganizationConfig({ organizationProfile: { Code: 'ABC' } }).Code, 'ABC');
});

test('payment references use saved or deployed codes, otherwise a generic prefix, including database-error fallback', async () => {
  const normalizeSchoolCode = extract('functions/api/backend.js', 'normalizeSchoolCode');
  const getSchoolCode = extract('functions/api/backend.js', 'getSchoolCode', {
    normalizeSchoolCode, resolveOrganizationConfig, effectiveBranchProfile: async () => ({}),
    requireFirestoreEnv: () => {}, getDocument: async () => ({ SchoolCode: 'BPS' })
  });
  assert.equal(await getSchoolCode({ SCHOOL_CODE: 'OTHER' }), 'BPS');
  const empty = extract('functions/api/backend.js', 'getSchoolCode', {
    normalizeSchoolCode, resolveOrganizationConfig, effectiveBranchProfile: async () => ({}),
    requireFirestoreEnv: () => {}, getDocument: async () => null
  });
  assert.equal(await empty({ SCHOOL_CODE: 'ABC' }), 'ABC');
  assert.equal(await empty({}), 'ORG');
  const unavailable = extract('functions/api/backend.js', 'getSchoolCode', {
    normalizeSchoolCode, resolveOrganizationConfig,
    requireFirestoreEnv: () => { throw new Error('Unavailable'); }
  });
  assert.equal(await unavailable({}), 'ORG');
  assert.equal(await unavailable({ SCHOOL_CODE: 'ABC' }), 'ABC');
});

test('new application/admission/receipt numbering never assumes DCA and preserves prior references', () => {
  const normalizeSchoolCode = extract('functions/api/backend.js', 'normalizeSchoolCode');
  const admission = extract('functions/api/backend.js', 'nextStudentAdmissionNo', {
    normalizeSchoolCode, pick: (row, keys) => keys.map(key => row[key]).find(Boolean)
  });
  const application = extract('functions/api/submit-application.js', 'nextApplicationReference');
  const receipt = extract('functions/api/verify-form-payment.js', 'makeReceiptNo');
  const year = String(new Date().getFullYear()).slice(-2);
  assert.match(admission([], ''), /^ORG\//);
  assert.match(application([]), /^ORG\//);
  assert.match(receipt('PAY123456'), /^ORG\/FORM\//);
  assert.equal(admission([{ AdmissionNo: `BPS/${year}/000007` }], '', 'BPS'), `BPS/${year}/000008`);
  assert.equal(application([{ ApplicationReference: `BPS/${year}/000007` }], 'BPS'), `BPS/${year}/000008`);
  assert.match(receipt('PAY123456', 'BPS'), /^BPS\/FORM\//);
  const historical = [{ AdmissionNo: 'DCA/21/000001' }];
  admission(historical, '', 'BPS');
  assert.equal(historical[0].AdmissionNo, 'DCA/21/000001');
});

test('no school-specific default remains in production settings or reference-generation source', () => {
  for (const path of files) assert.doesNotMatch(sources[path], /['"]DCA['"]/, path);
});
