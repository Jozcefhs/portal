import { getDocument } from './firestore.js';
import {
  applyBranchProfileOverrides,
  BRANCH_PROFILE_OVERRIDE_COLLECTION
} from './branch-profile-settings.js';
import { safeScopeId } from './school-scope.js';

const clean = (value) => String(value ?? '').trim();

// Finance must use the same branch inheritance as Settings, but must not
// silently fall back to defaults when an override could not be read.
export async function loadFinanceSchoolProfile(env, branchId = '', readDocument = getDocument) {
  const requestedBranch = clean(branchId).toLowerCase();
  const scopedBranch = requestedBranch && requestedBranch !== 'all' ? safeScopeId(branchId) : '';
  let profile, overrides;
  try {
    [profile, overrides] = await Promise.all([
      readDocument(env, 'settings', 'schoolProfile'),
      scopedBranch
        ? readDocument(env, BRANCH_PROFILE_OVERRIDE_COLLECTION, scopedBranch)
        : Promise.resolve(null)
    ]);
  } catch (cause) {
    throw Object.assign(new Error('Could not load school settings for Accounts. Refresh and try again; no financial totals were shown.'), {
      status: 503,
      code: 'FINANCE_SETTINGS_UNAVAILABLE',
      cause
    });
  }
  return applyBranchProfileOverrides({
    CurrentAcademicSession: clean(env.CURRENT_ACADEMIC_SESSION),
    CurrentTerm: clean(env.CURRENT_TERM) || 'First Term',
    ...(profile || {})
  }, overrides, scopedBranch);
}
