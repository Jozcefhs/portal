import { requiredDeploymentIdentity } from './deployment-identity.js';

export const HOSPITAL_COLLECTIONS = Object.freeze([
  'Patients', 'Numbers', 'PatientMatches', 'Cards', 'Operations', 'Audit', 'Visits', 'OpenVisits',
  'Encounters', 'CareSummaries', 'Consultations', 'ClinicalEntries'
]);

export function hospitalCollectionPath(env, name) {
  const identity = requiredDeploymentIdentity(env);
  if (identity.edition !== 'hospital' || !HOSPITAL_COLLECTIONS.includes(name)) {
    throw Object.assign(new Error('Invalid Hospital storage scope.'), { status: 403 });
  }
  return `hospitalWorkspaces/${identity.workspaceId}/hospital${name}`;
}
