import { batchUpsertDocuments, listCollection, upsertDocument } from '../firestore.js';
import { validatePayrollFormula } from './formula-engine.js';
import { validateTaxBands } from './paye-engine.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const number = (value) => { const result = Number(String(value ?? '0').replace(/,/g, '')); return Number.isFinite(result) ? result : 0; };
const yesNo = (value, fallback = 'NO') => ['yes', 'true', '1', 'active'].includes(lower(value)) ? 'YES' : (['no', 'false', '0', 'inactive'].includes(lower(value)) ? 'NO' : fallback);
const now = () => new Date().toISOString();
const slug = (value) => clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'ITEM';
const documentData = (row) => { const result = { ...row }; delete result.__id; delete result.__name; return result; };

export const PAYROLL_TAX_COLLECTIONS = Object.freeze({
  components: 'payrollSalaryComponents', profiles: 'payrollTaxProfiles', bands: 'payrollTaxBands',
  reliefs: 'payrollTaxReliefRules', mappings: 'payrollLedgerMappings', overrides: 'payrollTaxOverrides', migrations: 'payrollMigrations'
});

export const PAYROLL_FORMULA_VARIABLES = Object.freeze([
  'Basic', 'Gross', 'TaxableEarnings', 'PensionableEarnings', 'AnnualGross', 'AnnualTaxableIncome',
  'ChargeableIncome', 'CRA', 'QualifyingReliefs', 'PensionRate', 'NHFRate', 'CalculatedAnnualPaye'
]);

function configError(message, status = 400, code = 'INVALID_PAYROLL_TAX_CONFIG') {
  const error = new Error(message); error.status = status; error.code = code; return error;
}

function traditionalSeed(effectiveFrom = '') {
  const profile = {
    ProfileId: 'NGA-TRADITIONAL-PAYE-V1', ProfileFamilyId: 'NGA-TRADITIONAL-PAYE', Version: 1,
    Name: 'Traditional Nigerian PAYE', Country: 'Nigeria', Jurisdiction: 'FCT',
    Description: 'Configurable annual progressive PAYE profile seeded from the school-approved implementation brief.',
    CalculationMethod: 'PROGRESSIVE_ANNUAL_PAYE', EffectiveFrom: clean(effectiveFrom), EffectiveTo: '',
    Active: 'NO', Status: 'DRAFT', IsDefault: 'YES', AnnualizationMethod: 'MONTHLY_X_12',
    MinimumTaxEnabled: 'NO', MinimumTaxFormula: '', RoundingMethod: 'NEAREST', RoundingPrecision: 2,
    CraEnabled: 'YES', CraFixedRelief: 200000, CraGrossComparisonRate: 1, CraAdditionalReliefRate: 20,
    CreatedAt: now(), UpdatedAt: now(), SeedVersion: 'PAYE_PHASE2_V1'
  };
  const limits = [
    [1, 0, 300000, 7, false], [2, 300000, 600000, 11, false], [3, 600000, 1100000, 15, false],
    [4, 1100000, 1600000, 19, false], [5, 1600000, 3200000, 21, false], [6, 3200000, 0, 24, true]
  ];
  const bands = limits.map(([Sequence, LowerLimit, UpperLimit, Rate, open]) => ({
    BandId: `${profile.ProfileId}-B${String(Sequence).padStart(2, '0')}`, TaxProfileId: profile.ProfileId,
    Sequence, LowerLimit, UpperLimit, Rate, IsOpenEnded: open ? 'YES' : 'NO', EffectiveFrom: clean(effectiveFrom), EffectiveTo: '',
    Active: 'YES', CreatedAt: now(), UpdatedAt: now(), SeedVersion: 'PAYE_PHASE2_V1'
  }));
  const reliefs = [
    ['PENSION', 'Employee Pension Contribution', 'PENSION', ['PENSION']],
    ['NHF', 'National Housing Fund Contribution', 'NHF', ['NHF']],
    ['LIFE-ASSURANCE', 'Approved Life Assurance', 'OTHER', ['LIFE_ASSURANCE']]
  ].map(([code, Name, Category, SourceComponentCodes], index) => ({
    RuleId: `${profile.ProfileId}-RELIEF-${code}`, TaxProfileId: profile.ProfileId, Name, Code: code,
    RuleType: 'COMPONENT_TOTAL', Formula: '', FixedAmount: 0, PercentageRate: 0, PercentageBase: '', SourceComponentCodes,
    Category, ReducesTaxableIncome: 'YES', EffectiveFrom: clean(effectiveFrom), EffectiveTo: '', Active: 'YES',
    DisplayOrder: (index + 1) * 10, CreatedAt: now(), UpdatedAt: now(), SeedVersion: 'PAYE_PHASE2_V1'
  }));
  return { profile, bands, reliefs };
}

async function commitChunks(env, writes) {
  const unique = [...new Map((writes || []).map((write) => [`${write.collectionPath}/${write.documentId}`, write])).values()];
  for (let index = 0; index < unique.length; index += 450) await batchUpsertDocuments(env, unique.slice(index, index + 450));
  return unique.length;
}

export async function getPayrollTaxConfiguration(env) {
  const [components, profiles, bands, reliefs, mappings, overrides, migrations, runs, items] = await Promise.all([
    listCollection(env, PAYROLL_TAX_COLLECTIONS.components).catch(() => []), listCollection(env, PAYROLL_TAX_COLLECTIONS.profiles).catch(() => []),
    listCollection(env, PAYROLL_TAX_COLLECTIONS.bands).catch(() => []), listCollection(env, PAYROLL_TAX_COLLECTIONS.reliefs).catch(() => []),
    listCollection(env, PAYROLL_TAX_COLLECTIONS.mappings).catch(() => []), listCollection(env, PAYROLL_TAX_COLLECTIONS.overrides).catch(() => []),
    listCollection(env, PAYROLL_TAX_COLLECTIONS.migrations).catch(() => []), listCollection(env, 'payrollRuns').catch(() => []),
    listCollection(env, 'payrollItems').catch(() => [])
  ]);
  const finalizedRunIds = new Set(runs.filter((row) => ['approved', 'posted', 'part paid', 'paid', 'finalized'].includes(lower(row.Status))).map((row) => lower(row.RunId)));
  const usage = {};
  items.filter((row) => finalizedRunIds.has(lower(row.RunId))).forEach((row) => {
    const id = clean(row.TaxProfileId || row.TaxProfileSnapshot?.ProfileId); if (id) usage[id] = (usage[id] || 0) + 1;
  });
  return { components, profiles: profiles.map((row) => ({ ...row, UsageCount: usage[clean(row.ProfileId || row.__id)] || 0 })), bands, reliefs, mappings, overrides, migrations, usage };
}

export async function seedTraditionalPayeConfiguration(env, body = {}) {
  const existing = await listCollection(env, PAYROLL_TAX_COLLECTIONS.profiles).catch(() => []);
  if (existing.length) return { seeded: false, message: 'Tax profiles already exist; seed data was not overwritten.', profile: existing[0] };
  const seed = traditionalSeed(body.EffectiveFrom || body.effectiveFrom);
  const writes = [
    { collectionPath: PAYROLL_TAX_COLLECTIONS.profiles, documentId: seed.profile.ProfileId, data: seed.profile },
    ...seed.bands.map((row) => ({ collectionPath: PAYROLL_TAX_COLLECTIONS.bands, documentId: row.BandId, data: row })),
    ...seed.reliefs.map((row) => ({ collectionPath: PAYROLL_TAX_COLLECTIONS.reliefs, documentId: row.RuleId, data: row }))
  ];
  await commitChunks(env, writes);
  return { seeded: true, message: 'Traditional Nigerian PAYE draft configuration seeded. Verify its effective date before activation.', ...seed };
}

function validateProfilePayload(body, existing = {}) {
  const profileId = clean(body.ProfileId || existing.ProfileId || body.__id);
  const payload = {
    ...documentData(existing), ...documentData(body), ProfileId: profileId, ProfileFamilyId: clean(body.ProfileFamilyId || existing.ProfileFamilyId || profileId),
    Version: Math.max(1, Math.trunc(number(body.Version || existing.Version || 1))), Name: clean(body.Name || existing.Name),
    Country: clean(body.Country || existing.Country || 'Nigeria'), Jurisdiction: clean(body.Jurisdiction || existing.Jurisdiction || 'FCT'),
    CalculationMethod: clean(body.CalculationMethod || existing.CalculationMethod || 'PROGRESSIVE_ANNUAL_PAYE'),
    AnnualizationMethod: clean(body.AnnualizationMethod || existing.AnnualizationMethod || 'MONTHLY_X_12'),
    Active: yesNo(body.Active ?? existing.Active, 'NO'), Status: clean(body.Status || existing.Status || 'DRAFT').toUpperCase(), IsDefault: yesNo(body.IsDefault ?? existing.IsDefault, 'NO'),
    MinimumTaxEnabled: yesNo(body.MinimumTaxEnabled ?? existing.MinimumTaxEnabled, 'NO'),
    RoundingMethod: clean(body.RoundingMethod || existing.RoundingMethod || 'NEAREST').toUpperCase(), RoundingPrecision: Math.trunc(number(body.RoundingPrecision ?? existing.RoundingPrecision ?? 2)),
    CraEnabled: yesNo(body.CraEnabled ?? existing.CraEnabled, 'YES'), CraFixedRelief: Math.max(0, number(body.CraFixedRelief ?? existing.CraFixedRelief)),
    CraGrossComparisonRate: Math.max(0, number(body.CraGrossComparisonRate ?? existing.CraGrossComparisonRate)), CraAdditionalReliefRate: Math.max(0, number(body.CraAdditionalReliefRate ?? existing.CraAdditionalReliefRate)),
    UpdatedAt: now(), CreatedAt: existing.CreatedAt || now()
  };
  delete payload.UsageCount;
  if (!payload.ProfileId || !payload.Name || !payload.Jurisdiction) throw configError('Profile ID, name, and jurisdiction are required.');
  if (!['DRAFT', 'ACTIVE', 'RETIRED'].includes(payload.Status)) throw configError('Choose Draft, Active, or Retired profile status.');
  if (payload.Active === 'YES' && payload.Status !== 'ACTIVE') throw configError('Set profile status to Active before activating the profile.');
  if (payload.AnnualizationMethod !== 'MONTHLY_X_12') throw configError('Phase 2 supports monthly annualization only.');
  if (!['NEAREST', 'UP', 'DOWN', 'NONE'].includes(payload.RoundingMethod) || payload.RoundingPrecision < 0 || payload.RoundingPrecision > 6) throw configError('Choose a valid rounding method and precision from 0 to 6.');
  if (payload.MinimumTaxEnabled === 'YES') validatePayrollFormula(clean(payload.MinimumTaxFormula), PAYROLL_FORMULA_VARIABLES);
  return payload;
}

export async function savePayrollTaxProfile(env, body, actor = '') {
  const config = await getPayrollTaxConfiguration(env); const id = clean(body.ProfileId);
  const existing = config.profiles.find((row) => clean(row.ProfileId || row.__id) === id) || {};
  if (existing.ProfileId && number(existing.UsageCount) > 0) throw configError('This tax-profile version is used by finalized payroll. Clone it to create a new version.', 409, 'TAX_PROFILE_IMMUTABLE');
  const payload = validateProfilePayload(body, existing); payload.UpdatedBy = actor; payload.CreatedBy = existing.CreatedBy || actor;
  if (payload.Active === 'YES') {
    if (!clean(payload.EffectiveFrom)) throw configError('An active tax profile requires an effective-from date.');
    validateTaxBands(config.bands.filter((row) => clean(row.TaxProfileId) === payload.ProfileId));
    if (payload.IsDefault === 'YES') {
      const from = clean(payload.EffectiveFrom) || '0000-01-01'; const to = clean(payload.EffectiveTo) || '9999-12-31';
      const conflict = config.profiles.find((row) => clean(row.ProfileId || row.__id) !== payload.ProfileId && yesNo(row.Active, 'NO') === 'YES' && yesNo(row.IsDefault, 'NO') === 'YES' && lower(row.Jurisdiction) === lower(payload.Jurisdiction) && (clean(row.EffectiveFrom) || '0000-01-01') <= to && (clean(row.EffectiveTo) || '9999-12-31') >= from);
      if (conflict) throw configError(`Default profile dates overlap ${clean(conflict.ProfileId || conflict.__id)} for ${payload.Jurisdiction}.`, 409, 'OVERLAPPING_DEFAULT_TAX_PROFILE');
    }
  }
  await upsertDocument(env, PAYROLL_TAX_COLLECTIONS.profiles, payload.ProfileId, payload);
  return payload;
}

export async function clonePayrollTaxProfile(env, body, actor = '') {
  const config = await getPayrollTaxConfiguration(env); const sourceId = clean(body.SourceProfileId || body.ProfileId);
  const source = config.profiles.find((row) => clean(row.ProfileId || row.__id) === sourceId);
  if (!source) throw configError('Source tax profile was not found.', 404);
  const nextVersion = Math.max(1, ...config.profiles.filter((row) => clean(row.ProfileFamilyId) === clean(source.ProfileFamilyId)).map((row) => number(row.Version))) + 1;
  const id = clean(body.NewProfileId) || `${clean(source.ProfileFamilyId)}-V${nextVersion}`;
  if (config.profiles.some((row) => clean(row.ProfileId || row.__id) === id)) throw configError('The new profile ID already exists.', 409);
  const effectiveFrom = clean(body.EffectiveFrom); if (!effectiveFrom) throw configError('A new effective-from date is required.');
  const profile = validateProfilePayload({ ...source, ...body, ProfileId: id, Version: nextVersion, EffectiveFrom: effectiveFrom, EffectiveTo: '', Active: 'NO', Status: 'DRAFT', ClonedFromProfileId: sourceId }, {});
  profile.CreatedBy = actor; profile.UpdatedBy = actor;
  const sourceBands = config.bands.filter((row) => clean(row.TaxProfileId) === sourceId);
  const sourceReliefs = config.reliefs.filter((row) => clean(row.TaxProfileId) === sourceId);
  const writes = [{ collectionPath: PAYROLL_TAX_COLLECTIONS.profiles, documentId: id, data: profile }];
  sourceBands.forEach((row) => { const data = { ...documentData(row), BandId: `${id}-B${String(number(row.Sequence)).padStart(2, '0')}`, TaxProfileId: id, EffectiveFrom: effectiveFrom, EffectiveTo: '', CreatedAt: now(), UpdatedAt: now(), CreatedBy: actor }; writes.push({ collectionPath: PAYROLL_TAX_COLLECTIONS.bands, documentId: data.BandId, data }); });
  sourceReliefs.forEach((row) => { const data = { ...documentData(row), RuleId: `${id}-RELIEF-${slug(row.Code || row.Name)}`, TaxProfileId: id, EffectiveFrom: effectiveFrom, EffectiveTo: '', CreatedAt: now(), UpdatedAt: now(), CreatedBy: actor }; writes.push({ collectionPath: PAYROLL_TAX_COLLECTIONS.reliefs, documentId: data.RuleId, data }); });
  await commitChunks(env, writes); return { profile, bands: writes.filter((row) => row.collectionPath === PAYROLL_TAX_COLLECTIONS.bands).map((row) => row.data), reliefs: writes.filter((row) => row.collectionPath === PAYROLL_TAX_COLLECTIONS.reliefs).map((row) => row.data) };
}

export async function savePayrollSalaryComponent(env, body, actor = '') {
  const rows = await listCollection(env, PAYROLL_TAX_COLLECTIONS.components).catch(() => []);
  const id = clean(body.ComponentId) || `COMP-${slug(body.Code || body.Name)}`;
  const existing = rows.find((row) => clean(row.ComponentId || row.__id) === id) || {};
  const formula = clean(body.Formula ?? existing.Formula); const calculationType = clean(body.CalculationType || existing.CalculationType || 'fixed_amount').toLowerCase();
  if (!['earning', 'deduction', 'employer_contribution', 'relief'].includes(lower(body.ComponentType || existing.ComponentType))) throw configError('Choose a valid salary component type.');
  if (!['fixed_amount', 'percentage', 'formula', 'manual_input'].includes(calculationType)) throw configError('Choose a valid component calculation type.');
  const componentVariables = [...PAYROLL_FORMULA_VARIABLES, ...rows.map((row) => clean(row.Code)).filter(Boolean), clean(body.Code || existing.Code)].filter(Boolean);
  if (calculationType === 'formula') validatePayrollFormula(formula, componentVariables);
  const payload = {
    ...documentData(existing), ...documentData(body), ComponentId: id, Name: clean(body.Name || existing.Name), Code: clean(body.Code || existing.Code || slug(body.Name)).toUpperCase(),
    ComponentType: lower(body.ComponentType || existing.ComponentType), CalculationType: calculationType, Formula: formula,
    PercentageRate: Math.max(0, number(body.PercentageRate ?? existing.PercentageRate)), PercentageBase: clean(body.PercentageBase ?? existing.PercentageBase),
    IsTaxable: yesNo(body.IsTaxable ?? existing.IsTaxable), IsPensionable: yesNo(body.IsPensionable ?? existing.IsPensionable),
    IsNhfApplicable: yesNo(body.IsNhfApplicable ?? existing.IsNhfApplicable), ReducesTaxableIncome: yesNo(body.ReducesTaxableIncome ?? existing.ReducesTaxableIncome),
    IsPreTax: yesNo(body.IsPreTax ?? existing.IsPreTax), IsPostTax: yesNo(body.IsPostTax ?? existing.IsPostTax), IsRecurring: yesNo(body.IsRecurring ?? existing.IsRecurring, 'YES'),
    Active: yesNo(body.Active ?? existing.Active, 'YES'), EffectiveFrom: clean(body.EffectiveFrom ?? existing.EffectiveFrom), EffectiveTo: clean(body.EffectiveTo ?? existing.EffectiveTo),
    DisplayOrder: number(body.DisplayOrder ?? existing.DisplayOrder ?? 100), UpdatedAt: now(), UpdatedBy: actor, CreatedAt: existing.CreatedAt || now(), CreatedBy: existing.CreatedBy || actor
  };
  if (!payload.Name || !payload.Code) throw configError('Component name and code are required.');
  if (rows.some((row) => clean(row.ComponentId || row.__id) !== id && lower(row.Code) === lower(payload.Code))) throw configError('Another salary component already uses that code.', 409);
  await upsertDocument(env, PAYROLL_TAX_COLLECTIONS.components, id, payload); return payload;
}

export async function savePayrollTaxBands(env, body, actor = '') {
  const profileId = clean(body.TaxProfileId || body.ProfileId); const rows = Array.isArray(body.Bands) ? body.Bands : [];
  if (!profileId || !rows.length) throw configError('Tax profile and at least one tax band are required.');
  const config = await getPayrollTaxConfiguration(env); const profile = config.profiles.find((row) => clean(row.ProfileId || row.__id) === profileId);
  if (!profile) throw configError('Tax profile was not found.', 404);
  if (number(profile.UsageCount) > 0) throw configError('Bands for a used profile version are immutable. Clone the profile first.', 409, 'TAX_PROFILE_IMMUTABLE');
  const normalized = rows.map((row, index) => ({ ...documentData(row), BandId: clean(row.BandId) || `${profileId}-B${String(index + 1).padStart(2, '0')}`, TaxProfileId: profileId, Sequence: Math.trunc(number(row.Sequence || index + 1)), LowerLimit: number(row.LowerLimit), UpperLimit: number(row.UpperLimit), Rate: number(row.Rate), IsOpenEnded: yesNo(row.IsOpenEnded), EffectiveFrom: clean(row.EffectiveFrom || profile.EffectiveFrom), EffectiveTo: clean(row.EffectiveTo || profile.EffectiveTo), Active: yesNo(row.Active ?? 'YES', 'YES'), UpdatedAt: now(), UpdatedBy: actor, CreatedAt: row.CreatedAt || now(), CreatedBy: row.CreatedBy || actor }));
  validateTaxBands(normalized); await commitChunks(env, normalized.map((row) => ({ collectionPath: PAYROLL_TAX_COLLECTIONS.bands, documentId: row.BandId, data: row }))); return normalized;
}

export async function savePayrollTaxReliefRules(env, body, actor = '') {
  const profileId = clean(body.TaxProfileId || body.ProfileId); const rows = Array.isArray(body.Rules) ? body.Rules : [];
  if (!profileId) throw configError('Tax profile is required.');
  const config = await getPayrollTaxConfiguration(env); const profile = config.profiles.find((row) => clean(row.ProfileId || row.__id) === profileId);
  if (!profile) throw configError('Tax profile was not found.', 404);
  if (number(profile.UsageCount) > 0) throw configError('Reliefs for a used profile version are immutable. Clone the profile first.', 409, 'TAX_PROFILE_IMMUTABLE');
  const componentVariables = [...PAYROLL_FORMULA_VARIABLES, ...(config.components || []).map((row) => clean(row.Code)).filter(Boolean)];
  const normalized = rows.map((row, index) => {
    const formula = clean(row.Formula); if (formula) validatePayrollFormula(formula, componentVariables);
    return { ...documentData(row), RuleId: clean(row.RuleId) || `${profileId}-RELIEF-${slug(row.Code || row.Name || index + 1)}`, TaxProfileId: profileId, Name: clean(row.Name), Code: clean(row.Code || row.Name).toUpperCase(), RuleType: clean(row.RuleType || 'COMPONENT_TOTAL'), Formula: formula, FixedAmount: Math.max(0, number(row.FixedAmount)), PercentageRate: Math.max(0, number(row.PercentageRate)), PercentageBase: clean(row.PercentageBase), SourceComponentCodes: Array.isArray(row.SourceComponentCodes) ? row.SourceComponentCodes.map(clean).filter(Boolean) : clean(row.SourceComponentCodes).split(',').map(clean).filter(Boolean), ReducesTaxableIncome: yesNo(row.ReducesTaxableIncome ?? 'YES', 'YES'), EffectiveFrom: clean(row.EffectiveFrom || profile.EffectiveFrom), EffectiveTo: clean(row.EffectiveTo || profile.EffectiveTo), Active: yesNo(row.Active ?? 'YES', 'YES'), DisplayOrder: number(row.DisplayOrder || (index + 1) * 10), UpdatedAt: now(), UpdatedBy: actor, CreatedAt: row.CreatedAt || now(), CreatedBy: row.CreatedBy || actor };
  });
  if (normalized.some((row) => !row.Name || !row.Code)) throw configError('Every relief rule requires a name and code.');
  await commitChunks(env, normalized.map((row) => ({ collectionPath: PAYROLL_TAX_COLLECTIONS.reliefs, documentId: row.RuleId, data: row }))); return normalized;
}

export async function savePayrollLedgerMapping(env, body, actor = '') {
  const type = clean(body.MappingType || body.Type).toUpperCase(); const componentCode = clean(body.ComponentCode).toUpperCase();
  const allowed = ['GROSS_SALARY', 'PAYE', 'PENSION', 'NHF', 'OTHER_DEDUCTIONS', 'NET_SALARY', 'EMPLOYER_CONTRIBUTION', 'COMPONENT'];
  if (!allowed.includes(type)) throw configError('Choose a valid payroll ledger mapping type.');
  if (type === 'COMPONENT' && !componentCode) throw configError('A component code is required for a component-specific mapping.');
  const debit = clean(body.DebitAccountId || body.DebitAccount); const credit = clean(body.CreditAccountId || body.CreditAccount);
  if (!debit && !credit) throw configError('Enter at least one debit or credit ledger account.');
  const id = clean(body.MappingId) || `MAP-${slug(type)}${componentCode ? `-${slug(componentCode)}` : ''}`;
  const existing = (await listCollection(env, PAYROLL_TAX_COLLECTIONS.mappings).catch(() => [])).find((row) => clean(row.MappingId || row.__id) === id) || {};
  const payload = { ...documentData(existing), ...documentData(body), MappingId: id, MappingType: type, ComponentCode: componentCode,
    DebitAccountId: debit, CreditAccountId: credit, Description: clean(body.Description), EffectiveFrom: clean(body.EffectiveFrom), EffectiveTo: clean(body.EffectiveTo),
    Active: yesNo(body.Active ?? existing.Active, 'YES'), UpdatedAt: now(), UpdatedBy: actor, CreatedAt: existing.CreatedAt || now(), CreatedBy: existing.CreatedBy || actor };
  delete payload.UsageCount;
  await upsertDocument(env, PAYROLL_TAX_COLLECTIONS.mappings, id, payload); return payload;
}

export function validatePayrollTaxConfigurationData(config) {
  const errors = []; const warnings = [];
  const profiles = (config.profiles || []).filter((row) => yesNo(row.Active, 'NO') === 'YES');
  if (!profiles.length) warnings.push('No active tax profile exists. Legacy payroll remains available, but new-engine payroll cannot be finalized.');
  profiles.forEach((profile) => {
    try { validateProfilePayload(profile, profile); } catch (error) { errors.push(`${profile.Name || profile.ProfileId}: ${error.message}`); }
    try { validateTaxBands((config.bands || []).filter((row) => clean(row.TaxProfileId) === clean(profile.ProfileId))); } catch (error) { errors.push(`${profile.Name || profile.ProfileId}: ${error.message}`); }
  });
  const defaults = profiles.filter((row) => yesNo(row.IsDefault, 'NO') === 'YES'); if (defaults.length > 1) warnings.push('More than one active default tax profile exists; effective-date and jurisdiction selection must resolve the ambiguity.');
  if (profiles.length) {
    const mappingTypes = new Set((config.mappings || []).filter((row) => yesNo(row.Active, 'YES') === 'YES').map((row) => clean(row.MappingType).toUpperCase()));
    const missingMappings = ['GROSS_SALARY', 'PAYE', 'PENSION', 'NHF', 'OTHER_DEDUCTIONS', 'NET_SALARY'].filter((type) => !mappingTypes.has(type));
    if (missingMappings.length) warnings.push(`Payroll posting mappings still required: ${missingMappings.join(', ')}.`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

function legacyComponentDefinition(name, type) {
  const earning = type === 'earning'; const code = `${earning ? 'EARN' : 'DEDUCT'}-${slug(name)}`;
  return { ComponentId: `COMP-${code}`, Name: clean(name), Code: code, ComponentType: earning ? 'earning' : 'deduction', CalculationType: 'fixed_amount', Formula: '', PercentageRate: 0, PercentageBase: '', IsTaxable: earning ? 'YES' : 'NO', IsPensionable: earning ? 'YES' : 'NO', IsNhfApplicable: 'NO', ReducesTaxableIncome: 'NO', IsPreTax: 'NO', IsPostTax: earning ? 'NO' : 'YES', IsRecurring: 'YES', Active: 'YES', EffectiveFrom: '', EffectiveTo: '', DisplayOrder: 100, MigrationInferred: 'YES', CreatedAt: now(), UpdatedAt: now() };
}

export function buildPayrollTaxPhase2MigrationPlan(input = {}, body = {}) {
  const migrationId = 'PAYE-PHASE2-V1'; const apply = yesNo(body.Apply ?? body.apply, 'NO') === 'YES';
  const markers = input.markers || []; const profiles = input.profiles || []; const runs = input.runs || [];
  const items = input.items || []; const existingComponents = input.existingComponents || [];
  const existingTaxProfiles = input.existingTaxProfiles || [];
  const marker = markers.find((row) => clean(row.MigrationId || row.__id) === migrationId);
  const definitions = new Map(existingComponents.map((row) => [clean(row.ComponentId || row.__id), documentData(row)]));
  const basic = { ...legacyComponentDefinition('Basic Salary', 'earning'), ComponentId: 'COMP-BASIC', Code: 'BASIC', DisplayOrder: 10 }; definitions.set(basic.ComponentId, basic);
  profiles.forEach((profile) => {
    (profile.Allowances || []).forEach((row) => { const def = legacyComponentDefinition(row.Name || row.name, 'earning'); if (def.Name) definitions.set(def.ComponentId, def); });
    (profile.Deductions || []).forEach((row) => { const def = legacyComponentDefinition(row.Name || row.name, 'deduction'); if (def.Name) definitions.set(def.ComponentId, def); });
  });
  const warnings = [];
  if (profiles.some((row) => !clean(row.Username))) warnings.push('Some payroll profiles have no staff username and require manual review.');
  const report = { MigrationId: migrationId, Apply: apply, AlreadyApplied: Boolean(marker), PayrollProfiles: profiles.length, PayrollRuns: runs.length, PayrollItems: items.length, ComponentDefinitions: definitions.size, ExistingTaxProfiles: existingTaxProfiles.length, LegacyItemsToMark: items.filter((row) => !row.CalculationVersion).length, Warnings: warnings };
  if (marker) return { report, marker, writes: [], alreadyApplied: true };
  const backupReference = clean(body.BackupReference); if (apply && !backupReference) throw configError('A verified backup reference is required before applying payroll migration.', 409, 'PAYROLL_BACKUP_REQUIRED');
  const writes = [];
  definitions.forEach((data, id) => writes.push({ collectionPath: PAYROLL_TAX_COLLECTIONS.components, documentId: id, data }));
  profiles.forEach((profile) => {
    const assignments = [{ ComponentId: 'COMP-BASIC', Code: 'BASIC', Amount: Math.max(0, number(profile.BasicSalary)), SourceField: 'BasicSalary' }];
    (profile.Allowances || []).forEach((row) => { const def = legacyComponentDefinition(row.Name || row.name, 'earning'); if (def.Name) assignments.push({ ComponentId: def.ComponentId, Code: def.Code, Amount: Math.max(0, number(row.Amount || row.amount)), SourceField: 'Allowances' }); });
    (profile.Deductions || []).forEach((row) => { const def = legacyComponentDefinition(row.Name || row.name, 'deduction'); if (def.Name) assignments.push({ ComponentId: def.ComponentId, Code: def.Code, Amount: Math.max(0, number(row.Amount || row.amount)), SourceField: 'Deductions' }); });
    const data = { ...documentData(profile), ComponentAssignments: profile.ComponentAssignments || assignments, CalculationMode: profile.CalculationMode || 'LEGACY_FLAT_RATE', LegacyTaxRate: number(profile.LegacyTaxRate ?? profile.TaxRate), TaxStatus: clean(profile.TaxStatus || 'TAXABLE'), TaxJurisdiction: clean(profile.TaxJurisdiction || 'FCT'), PensionParticipating: number(profile.PensionRate) > 0 ? 'YES' : 'NO', MigrationVersion: migrationId, MigratedAt: now() };
    writes.push({ collectionPath: 'payrollProfiles', documentId: profile.__id || slug(profile.EmployeeId), data });
  });
  runs.forEach((run) => { if (run.CalculationVersion) return; writes.push({ collectionPath: 'payrollRuns', documentId: run.__id || slug(run.RunId), data: { ...documentData(run), CalculationVersion: 'LEGACY_FLAT_RATE', LegacyTaxMode: 'YES', TaxTraceStatus: 'LEGACY_UNAVAILABLE' } }); });
  items.forEach((item) => { if (item.CalculationVersion) return; writes.push({ collectionPath: 'payrollItems', documentId: item.__id || slug(item.ItemId), data: { ...documentData(item), CalculationVersion: 'LEGACY_FLAT_RATE', LegacyTaxMode: 'YES', TaxTraceStatus: 'LEGACY_UNAVAILABLE', LegacyTaxRate: number(item.TaxRate), LegacyTaxAmount: number(item.TaxAmount) } }); });
  if (!existingTaxProfiles.length) {
    const seed = traditionalSeed(body.EffectiveFrom); writes.push({ collectionPath: PAYROLL_TAX_COLLECTIONS.profiles, documentId: seed.profile.ProfileId, data: seed.profile });
    seed.bands.forEach((row) => writes.push({ collectionPath: PAYROLL_TAX_COLLECTIONS.bands, documentId: row.BandId, data: row })); seed.reliefs.forEach((row) => writes.push({ collectionPath: PAYROLL_TAX_COLLECTIONS.reliefs, documentId: row.RuleId, data: row }));
  }
  const markerData = { MigrationId: migrationId, Status: 'APPLIED', AppliedAt: now(), AppliedBy: clean(body.RecordedBy), BackupReference: backupReference, Report: report };
  writes.push({ collectionPath: PAYROLL_TAX_COLLECTIONS.migrations, documentId: migrationId, data: markerData });
  report.DocumentsPlanned = writes.length;
  return { report, marker: markerData, writes, alreadyApplied: false };
}

export async function migratePayrollTaxPhase2(env, body = {}) {
  const [markers, profiles, runs, items, existingComponents, existingTaxProfiles] = await Promise.all([
    listCollection(env, PAYROLL_TAX_COLLECTIONS.migrations).catch(() => []), listCollection(env, 'payrollProfiles').catch(() => []),
    listCollection(env, 'payrollRuns').catch(() => []), listCollection(env, 'payrollItems').catch(() => []),
    listCollection(env, PAYROLL_TAX_COLLECTIONS.components).catch(() => []), listCollection(env, PAYROLL_TAX_COLLECTIONS.profiles).catch(() => [])
  ]);
  const plan = buildPayrollTaxPhase2MigrationPlan({ markers, profiles, runs, items, existingComponents, existingTaxProfiles }, body);
  const apply = yesNo(body.Apply ?? body.apply, 'NO') === 'YES';
  if (plan.alreadyApplied) return { ok: true, message: 'PAYE Phase 2 migration was already applied; no documents were changed.', report: plan.report, marker: plan.marker };
  if (!apply) return { ok: true, message: 'PAYE Phase 2 migration dry run completed; no documents were changed.', report: plan.report, marker: null };
  plan.report.DocumentsWritten = await commitChunks(env, plan.writes);
  return { ok: true, message: 'PAYE Phase 2 additive migration applied. Existing payroll amounts were preserved and marked legacy.', report: plan.report, marker: plan.marker };
}
