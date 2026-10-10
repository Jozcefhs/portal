import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../js/vendor-settlements.js', import.meta.url), 'utf8');
const window = {};
class FormDataFixture {
  constructor(form) { this.rows = Object.values(form.elements).filter(field => !field.disabled && (field.type !== 'checkbox' || field.checked)).map(field => [field.name, field.value]); }
  [Symbol.iterator]() { return this.rows[Symbol.iterator](); }
}
runInNewContext(source.replace('let mounted;', 'window.formChecks = { ruleVisibility, submitForm, accountSelect }; let mounted;'), { window, FormData: FormDataFixture });
const { ruleVisibility, submitForm, accountSelect } = window.formChecks;

function fixture(extra = {}) {
  const progress = { textContent: '' }, calls = [];
  const values = { Name:'Fixture vendor', RuleMode:'Inherit default', EffectiveDate:'2026-10-09', Rate:'0', FixedAmount:'0', Basis:'Per sale', Cycle:'Monthly', ...extra };
  const elements = Object.fromEntries(Object.entries(values).map(([name, value]) => {
    const label = { hidden:false, firstChild:{textContent:name === 'Name' ? 'Vendor name' : name} };
    const field = { name, value, disabled:false, dataset:{}, labels:[label], closest:()=>label, focus(){this.focused = true;}, reportValidity(){this.reported = true;} };
    if (name === 'Rate') field.dataset.rule = 'Percentage';
    if (name === 'FixedAmount') field.dataset.rule = 'Fixed charge';
    if (name === 'ChangeRule') { field.type = 'checkbox'; field.checked = value; field.value = 'on'; }
    Object.defineProperties(field, {
      willValidate:{ get:()=>!field.disabled },
      validity:{ get:()=>({valid:field.disabled || !(name === 'Name' && !field.value || name === 'Rate' && (Number(field.value) < 0 || Number(field.value) > 100) || name === 'FixedAmount' && Number(field.value) < 0 || name === 'EffectiveDate' && !field.value)}) },
      validationMessage:{ get:()=>name === 'Name' || name === 'EffectiveDate' ? 'Please fill out this field.' : 'Value is out of range.' }
    });
    return [name,field];
  }));
  // HTMLFormControlsCollection is both named and iterable.
  elements[Symbol.iterator] = function*(){ yield* Object.values(this); };
  const form = { elements, querySelector:()=>progress, querySelectorAll:()=>Object.values(elements).filter(field=>field.dataset.rule), checkValidity:()=>Object.values(elements).every(field=>field.validity.valid) };
  const save = async body => { calls.push(JSON.parse(JSON.stringify(body))); return {ok:true}; };
  ruleVisibility(form);
  return {form,progress,calls,save};
}

test('empty vendor name reports the exact blocker, focuses it and sends no save request', async () => {
  const f = fixture({Name:''});
  assert.equal(await submitForm(f.form,f.save),null);
  assert.equal(f.calls.length,0);
  assert.match(f.progress.textContent,/Vendor name: Please fill out this field/);
  assert.equal(f.form.elements.Name.focused,true);
  assert.equal(f.form.elements.Name.reported,true);
  f.form.elements.Name.value = 'Corrected vendor';
  await submitForm(f.form,f.save);
  assert.equal(f.calls.length,1); assert.equal(f.calls[0].Name,'Corrected vendor');
  assert.equal(f.progress.textContent,'');
});

test('irrelevant hidden commission fields cannot silently block inherited or full-payment registration', async () => {
  for (const mode of ['Inherit default','Full payment']) {
    const f = fixture({RuleMode:mode,Rate:'101',FixedAmount:'-5'});
    await submitForm(f.form,f.save);
    assert.equal(f.calls.length,1);
    assert.equal(f.calls[0].Rule.Mode,mode);
    for (const name of ['Rate','FixedAmount','Basis','Cycle']) assert.equal(f.form.elements[name].disabled,true);
    assert.equal(f.calls[0].Rule.Rate,undefined); assert.equal(f.calls[0].Rule.FixedAmount,undefined);
  }
});

test('applicable commission validation remains enforced and switching modes restores only relevant fields', async () => {
  const f = fixture({RuleMode:'Percentage',Rate:'101',FixedAmount:'-5'});
  await submitForm(f.form,f.save); assert.equal(f.calls.length,0); assert.match(f.progress.textContent,/Rate/);
  f.form.elements.Rate.value = '5';
  await submitForm(f.form,f.save); assert.equal(f.calls[0].Rule.Rate,'5');
  f.form.elements.RuleMode.value = 'Fixed charge'; f.form.elements.FixedAmount.value = '20'; f.form.elements.Basis.value = 'Per period';
  ruleVisibility(f.form); await submitForm(f.form,f.save);
  assert.equal(f.calls[1].Rule.FixedAmount,'20'); assert.equal(f.calls[1].Rule.Cycle,'Monthly'); assert.equal(f.calls[1].Rule.Rate,undefined);
  f.form.elements.Basis.value = 'Per sale'; ruleVisibility(f.form); await submitForm(f.form,f.save);
  assert.equal(f.calls[2].Rule.Cycle,undefined);
});

test('contact-only edit excludes unchecked rule changes and toggling change rule re-enables validation', async () => {
  const f = fixture({ChangeRule:false,EffectiveDate:'',RuleMode:'Percentage',Rate:'101'});
  await submitForm(f.form,f.save); assert.equal(f.calls.length,1); assert.equal(f.calls[0].Rule,undefined);
  f.form.elements.ChangeRule.checked = true; ruleVisibility(f.form);
  await submitForm(f.form,f.save); assert.equal(f.calls.length,1); assert.match(f.progress.textContent,/EffectiveDate/);
});

test('payload errors are visible and entries are retained for correction rather than failing silently', async () => {
  const f = fixture();
  await submitForm(f.form,f.save,()=>{throw new Error('Fixture preparation failed');});
  assert.equal(f.calls.length,0); assert.equal(f.progress.textContent,'Fixture preparation failed');
  assert.equal(f.form.elements.Name.value,'Fixture vendor');
});

test('generic modal keeps validation, error feedback and save controls visible; historical preview also validates', async () => {
  const css = await readFile(new URL('../css/vendor-settlements.css', import.meta.url),'utf8');
  const html = await readFile(new URL('../admin.html', import.meta.url),'utf8');
  assert.match(source,/<form class="vendor-form" novalidate>/);
  assert.match(source,/vendor-dialog-footer[^]*?role="status" aria-live="polite"[^]*?type="submit"/);
  assert.match(source,/submitForm\(form, body => call\(action, body, form\), transform\)/);
  assert.match(source,/submitForm\(form, payload => \{ body = \{ \.\.\.payload, VendorId:selected \}/);
  assert.match(css,/\.vendor-dialog-footer \{ position:sticky; bottom:-18px/);
  assert.match(html,/vendor-settlements\.js\?v=20261010-account-mappings/);
  assert.match(source,/This form does not create a sign-in account\. Leave it blank to register the vendor without portal access/);
});

test('account dropdown matches legacy numeric mappings and never silently selects another account', () => {
  const chart = [{Code:'4000',Name:'Tuition',Type:'Revenue',Active:'YES'},
    {Code:'4090',Name:'Commission',Type:'Revenue',Active:'YES'},
    {Code:1110,Name:'Receivable',Type:'Asset',Active:'YES'}];
  const selected = accountSelect('CommissionAccount','Income',chart,['Revenue'],4090);
  assert.match(selected,/<option value="4090" selected>4090 · Commission/);
  assert.doesNotMatch(selected,/<option value="4000" selected>/);
  assert.equal((selected.match(/ selected/g) || []).length,1);
  const unavailable = accountSelect('CommissionAccount','Income',chart,['Revenue'],'9999');
  assert.match(unavailable,/<option value="9999" selected>9999 · Unavailable — review mapping/);
  assert.doesNotMatch(unavailable,/<option value="(?:4000|4090)" selected>/);
  const missing = accountSelect('OffsetAccount','Offset',chart,['Revenue','Equity']);
  assert.match(missing,/<select name="OffsetAccount" required><option value="" selected>Choose an account/);
  assert.doesNotMatch(missing,/<option value="(?:4000|4090)" selected>/);
  assert.match(accountSelect('VendorReceivableAccount','Asset',chart,['Asset'],'1110'),/<option value="1110" selected>/);
});

test('account dropdown excludes inactive and wrong-type accounts and escapes labels', () => {
  const chart = ['NO','false',false,0,'inactive','disabled'].map((Active,i) => ({Code:`bad${i}`,Type:'Revenue',Active}));
  chart.push({Code:'2000',Type:'Liability',Name:'Wrong type',Active:'YES'},
    {Code:'4090',Type:'Revenue',Name:'Fees <script>',Active:'YES'});
  const html = accountSelect('OffsetAccount','Offset',chart,['Revenue','Equity']);
  assert.doesNotMatch(html,/bad\d|value="2000"|<script>/);
  assert.match(html,/Fees &lt;script&gt;/);
  assert.match(source,/accountSelect\('OffsetAccount'/);
  assert.match(source,/accountSelect\(key,label,data\.chart,\[type\],s\[key\]\)/);
});
