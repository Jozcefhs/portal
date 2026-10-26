import { getDocument, queryCollection, batchCommitLiteralDocuments } from './firestore.js';
import { requiredDeploymentIdentity } from './deployment-identity.js';
import { getSchoolStructure } from './school-scope.js';
import { configuredStaffBranches } from './staff-branch-context.js';
import { assignedStaffBranches } from './staff-branch-access.js';
import { historyDateRange } from './history-date-range.js';
import { hospitalCollectionPath } from './hospital-storage.js';
import { createHospitalClinicalService } from './hospital-clinical-service.js';
import { createHospitalOrdersService } from './hospital-orders-service.js';
import { clean, fail, id, nameKey, digest, stable, cardUid, hospitalBranch,
  hospitalCapabilities, patientFields, patientName, patientSummary, patientDetails } from './hospital-model.js';

const condition = row => row ? { updateTime: row.__updateTime || fail('Reload this record before saving.', 409) } : { exists: false };
const strip = row => Object.fromEntries(Object.entries(row || {}).filter(([key]) => !key.startsWith('__')));
const eq = (field, value) => ({ field, op: '==', value });

export function createHospitalService(env, user, overrides = {}) {
  const db = { getDocument, queryCollection, batchCommitLiteralDocuments, getSchoolStructure, ...overrides };
  const identity = requiredDeploymentIdentity(env);
  if (identity.edition !== 'hospital' || user.edition !== 'hospital') fail('This workspace is available only in the Hospital edition.', 403);
  if (user.subscriptionActive === false) fail('This subscription does not permit Hospital access.', 403);
  const collection = name => hospitalCollectionPath(env, name);
  const capabilities = hospitalCapabilities(user);
  const requireCapability = capability => { if (!capabilities.includes(capability)) fail('Your role does not permit this hospital operation.', 403); };
  const clock = () => (overrides.now ? overrides.now() : new Date()).toISOString();
  const actor = clean(user.username);
  if (!actor) fail('Sign in with your staff account.', 401);
  let branches;
  async function branch(body) {
    branches ||= configuredStaffBranches(await db.getSchoolStructure(env));
    return hospitalBranch(user, body.BranchId, branches);
  }
  async function patient(patientId, branchId) {
    const row = await db.getDocument(env, collection('Patients'), id(patientId));
    if (!row || !row.AccessBranchIds?.includes(branchId)) fail('The patient is not available in this branch.', 404);
    return row;
  }
  function auditWrite(key, action, branchId, subject = {}, extra = {}) {
    return { collectionPath: collection('Audit'), documentId: key, currentDocument: { exists: false }, data: {
      Action: action, Module: 'Hospital', BranchId: branchId, CreatedAt: clock(), Timestamp: clock(), Outcome: 'Success',
      Username: actor, ActorName: clean(user.displayName) || actor, ActorRole: user.role,
      Actor: clean(user.displayName) || actor, ActorUsername: actor,
      SubjectId: subject.PatientId || '', SubjectName: subject.PatientId ? patientName(subject) : '',
      Subject: subject.PatientId ? `${patientName(subject)} · ${subject.HospitalNumber}` : '',
      EntityType: subject.PatientId ? 'Patient' : 'Hospital register', EntityId: subject.PatientId || '',
      HospitalNumber: subject.HospitalNumber || '', Source: 'Web', SourcePlatform: 'Web', ...extra
    } };
  }
  async function operation(body, action, work) {
    if (user.subscriptionReadOnly === true) fail('This subscription currently permits viewing only.', 403);
    const requestId = id(body.RequestId);
    const opId = await digest(JSON.stringify([actor, action, requestId]));
    const fingerprint = await digest(JSON.stringify(stable(body)));
    const receipt = async () => {
      const saved = await db.getDocument(env, collection('Operations'), opId);
      if (!saved) return null;
      if (saved.Fingerprint !== fingerprint) fail('This request reference was already used for different information. Reload and try again.', 409);
      return { ok: true, ...saved.Result, replayed: true };
    };
    const previous = await receipt();
    if (previous) return previous;
    let commitStarted = false;
    try {
      const { writes, result } = await work(opId);
      // Unchanged form saves do not create receipts or repeat audit entries.
      if (!writes.length && result?.Unchanged === true) return { ok: true, ...result };
      writes.push({ collectionPath: collection('Operations'), documentId: opId, currentDocument: { exists: false },
        data: { Fingerprint: fingerprint, Result: result, CreatedAt: clock(), Actor: actor, Action: action } });
      commitStarted = true;
      await db.batchCommitLiteralDocuments(env, writes);
      return { ok: true, ...result };
    }
    catch (error) {
      if (Number(error.status) === 409) {
        const concurrent = await receipt(); if (concurrent) return concurrent;
        if (commitStarted) fail('Another user changed this record or card assignment. Reload before trying again.', 409);
      }
      throw error;
    }
  }
  async function auditRead(body, action, branchId, subject = {}, extra = {}) {
    const key = await digest(JSON.stringify([actor, action, id(body.RequestId), branchId, subject.PatientId || '']));
    try { await db.batchCommitLiteralDocuments(env, [auditWrite(key, action, branchId, subject, extra)]); }
    catch (error) {
      if (Number(error.status) !== 409 || !await db.getDocument(env, collection('Audit'), key)) throw error;
    }
  }
  function requireRevision(row, body) {
    if (!clean(body.Revision) || body.Revision !== row.__updateTime) fail('This patient record changed. Reload before saving.', 409);
  }
  async function page(name, filters, field, body) {
    const limit = 30;
    let cursor = {};
    if (body.Cursor) {
      const docId = id(body.Cursor.id);
      if (typeof body.Cursor.value !== 'string' || body.Cursor.value.length > 500) fail('Invalid page reference.');
      cursor = { startAfterName: `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection(name)}/${docId}`,
        startAfterFieldValue: body.Cursor.value };
    }
    const rows = await db.queryCollection(env, collection(name), { filters, limit: limit + 1,
      orderBy: [{ field }, { field: '__name__' }], ...cursor });
    const shown = rows.slice(0, limit), last = shown.at(-1);
    return { rows: shown, next: rows.length > limit ? { id: last.__id, value: last[field] } : null };
  }
  return {
    ...createHospitalOrdersService({env,user,db,collection,capabilities,requireCapability,branch,patient,clock,actor,
      condition,strip,eq,auditWrite,auditRead,operation,page}),
    ...createHospitalClinicalService({env,user,db,collection,capabilities,requireCapability,branch,patient,clock,actor,
      condition,strip,eq,auditWrite,auditRead,operation,page}),
    async state() {
      if (!capabilities.length) fail('Your role does not have Hospital workspace access.', 403);
      branches = configuredStaffBranches(await db.getSchoolStructure(env));
      const assigned = assignedStaffBranches(user);
      const permitted = branches.filter(row => assigned === null || assigned.includes(clean(row.id).toLowerCase()));
      return { ok: true, branches: permitted, capabilities, readOnly: user.subscriptionReadOnly === true };
    },
    async search(body) {
      requireCapability('patients.read'); const branchId = await branch(body);
      let rows, next = null;
      if (body.CardUid) {
        const key = await digest(cardUid(body.CardUid));
        const card = await db.getDocument(env, collection('Cards'), key);
        if (!card || card.Status !== 'Active') fail('This NFC card is not active or is not assigned.', 404);
        const row = await patient(card.PatientId, branchId);
        if (row.CardKey !== key) fail('This NFC card is no longer assigned.', 404);
        rows = [row];
      } else if (body.HospitalNumber) {
        const number = clean(body.HospitalNumber).toUpperCase();
        if (!/^H-[A-F0-9]{16}$/.test(number)) fail('Enter a valid hospital number.');
        const lookup = await db.getDocument(env, collection('Numbers'), number);
        rows = lookup ? [await patient(lookup.PatientId, branchId)] : [];
      } else {
        const query = nameKey(body.Query);
        if (query.length < 2 || query.length > 120) fail('Enter at least two letters of the surname to search.');
        const result = await page('Patients', [{ field: 'AccessBranchIds', op: 'ARRAY_CONTAINS', value: branchId },
          { field: 'SearchName', op: '>=', value: query }, { field: 'SearchName', op: '<=', value: `${query}\uf8ff` }], 'SearchName', body);
        rows = result.rows; next = result.next;
      }
      await auditRead(body, body.CardUid ? 'Find patient by NFC card' : 'Search patient register', branchId, {}, { ResultCount: rows.length });
      return { ok: true, patients: rows.map(patientSummary), next };
    },
    async details(body) {
      requireCapability('patients.read'); const branchId = await branch(body), row = await patient(body.PatientId, branchId);
      await auditRead(body, 'View patient registration', branchId, row);
      return { ok: true, patient: patientDetails(row) };
    },
    async savePatient(body) {
      requireCapability('patients.write'); const branchId = await branch(body);
      const fields = patientFields(body.Patient, clock().slice(0, 10));
      return operation(body, 'savePatient', async key => {
        const existing = body.PatientId ? await patient(body.PatientId, branchId) : null;
        if (existing) requireRevision(existing, body);
        const patientId = existing?.PatientId || key;
        if (existing && Object.entries(fields).every(([name,value]) => clean(existing[name]) === value)) {
          return { writes: [], result: { PatientId: patientId, HospitalNumber: existing.HospitalNumber, Unchanged: true } };
        }
        const row = { ...strip(existing), ...fields, PatientId: patientId,
          HospitalNumber: existing?.HospitalNumber || `H-${key.slice(0, 16).toUpperCase()}`,
          AccessBranchIds: existing?.AccessBranchIds || [branchId], Status: existing?.Status || 'Active',
          SearchName: nameKey(patientName(fields)), CreatedAt: existing?.CreatedAt || clock(), UpdatedAt: clock(), UpdatedBy: actor };
        const writes = [{ collectionPath: collection('Patients'), documentId: patientId, data: row, currentDocument: condition(existing) }];
        if (!existing) {
          const matchId = await digest(JSON.stringify([nameKey(fields.FirstName), nameKey(fields.LastName), fields.DateOfBirth || fields.Phone]));
          const match = await db.getDocument(env, collection('PatientMatches'), matchId);
          if (match && clean(body.DuplicateReviewReason).length < 10) fail('A matching patient registration exists. Search for the existing record. If this is a different person, record the identity checks and reason before registering.', 409);
          writes.push({ collectionPath: collection('Numbers'), documentId: row.HospitalNumber,
            data: { PatientId: patientId }, currentDocument: { exists: false } },
          { collectionPath: collection('PatientMatches'), documentId: matchId, currentDocument: condition(match),
            data: { FirstPatientId: match?.FirstPatientId || patientId, MostRecentPatientId: patientId, UpdatedAt: clock() } });
        }
        writes.push(auditWrite(key, existing ? 'Update patient registration' : 'Register patient', branchId, row,
          { DuplicateReviewReason: clean(body.DuplicateReviewReason).slice(0, 1000) }));
        return { writes, result: { PatientId: patientId, HospitalNumber: row.HospitalNumber } };
      });
    },
    async assignCard(body) {
      requireCapability('patients.write'); const branchId = await branch(body), uid = cardUid(body.CardUid);
      return operation(body, 'assignCard', async key => {
        const row = await patient(body.PatientId, branchId); requireRevision(row, body);
        const cardKey = await digest(uid), existing = await db.getDocument(env, collection('Cards'), cardKey);
        if (existing) fail('This NFC card was already issued. Use the assigned card or a new replacement card.', 409);
        const writes = [];
        if (row.CardKey) {
          if (!clean(body.Reason)) fail('Enter the reason for replacing this patient’s card.');
          const old = await db.getDocument(env, collection('Cards'), row.CardKey);
          if (!old || old.PatientId !== row.PatientId || old.Status !== 'Active') fail('Reload and review the existing card assignment.', 409);
          writes.push({ collectionPath: collection('Cards'), documentId: row.CardKey, currentDocument: condition(old),
            data: { ...strip(old), Status: 'Replaced', RevokedAt: clock(), RevokedBy: actor, Reason: clean(body.Reason).slice(0, 500) } });
        }
        writes.push({ collectionPath: collection('Cards'), documentId: cardKey, currentDocument: { exists: false },
          data: { PatientId: row.PatientId, Status: 'Active', AssignedAt: clock(), AssignedBy: actor, Last4: uid.slice(-4) } },
        { collectionPath: collection('Patients'), documentId: row.PatientId, currentDocument: condition(row),
          data: { ...strip(row), CardKey: cardKey, CardLast4: uid.slice(-4), UpdatedAt: clock(), UpdatedBy: actor } },
        auditWrite(key, row.CardKey ? 'Replace patient NFC card' : 'Assign patient NFC card', branchId, row));
        return { writes, result: { PatientId: row.PatientId } };
      });
    },
    async revokeCard(body) {
      requireCapability('patients.write'); const branchId = await branch(body);
      if (!clean(body.Reason)) fail('Enter a reason for revoking this card.');
      return operation(body, 'revokeCard', async key => {
        const row = await patient(body.PatientId, branchId); requireRevision(row, body);
        if (!row.CardKey) fail('This patient has no active NFC card.', 409);
        const old = await db.getDocument(env, collection('Cards'), row.CardKey);
        if (!old || old.PatientId !== row.PatientId || old.Status !== 'Active') fail('Reload and review the card assignment.', 409);
        return { writes: [
          { collectionPath: collection('Cards'), documentId: row.CardKey, currentDocument: condition(old),
            data: { ...strip(old), Status: 'Revoked', Reason: clean(body.Reason).slice(0, 500), RevokedAt: clock(), RevokedBy: actor } },
          { collectionPath: collection('Patients'), documentId: row.PatientId, currentDocument: condition(row),
            data: { ...strip(row), CardKey: '', CardLast4: '', UpdatedAt: clock(), UpdatedBy: actor } },
          auditWrite(key, 'Revoke patient NFC card', branchId, row)
        ], result: { PatientId: row.PatientId } };
      });
    },
    async checkIn(body) {
      requireCapability('visits.write'); const branchId = await branch(body);
      const department = clean(body.Department); if (!department || department.length > 120) fail('Enter the receiving department.');
      return operation(body, 'checkIn', async key => {
        const row = await patient(body.PatientId, branchId);
        if (row.Status !== 'Active') fail('This patient registration is not active.', 409);
        const lockId = await digest(JSON.stringify([branchId, row.PatientId]));
        const current = await db.getDocument(env, collection('OpenVisits'), lockId);
        if (current?.VisitId) fail('This patient already has an open visit in this branch. Open the existing visit.', 409);
        const visit = { VisitId: key, PatientId: row.PatientId, PatientName: patientName(row), HospitalNumber: row.HospitalNumber,
          BranchId: branchId, Department: department, Status: 'Waiting', CreatedAt: clock(), UpdatedAt: clock(), CreatedBy: actor };
        return { writes: [
          { collectionPath: collection('Visits'), documentId: key, data: visit, currentDocument: { exists: false } },
          { collectionPath: collection('OpenVisits'), documentId: lockId, data: { VisitId: key, PatientId: row.PatientId }, currentDocument: condition(current) },
          auditWrite(key, 'Check in patient', branchId, row, { VisitId: key })
        ], result: { PatientId: row.PatientId, VisitId: key } };
      });
    },
    async visits(body) {
      requireCapability('visits.read'); const branchId = await branch(body);
      const range = historyDateRange(body.DateRange);
      const start = new Date(`${range.fromDate}T00:00:00+01:00`), end = new Date(`${range.toDate}T00:00:00+01:00`);
      end.setTime(end.getTime() + 86400000);
      if (end - start > 93 * 86400000) fail('Choose a visit period of no more than 93 days.');
      const result = await page('Visits', [eq('BranchId', branchId),
        { field: 'CreatedAt', op: '>=', value: start.toISOString() }, { field: 'CreatedAt', op: '<', value: end.toISOString() }], 'CreatedAt', body);
      await auditRead(body, 'View reception visits', branchId, {}, { ResultCount: result.rows.length, FromDate: range.fromDate, ToDate: range.toDate });
      return { ok: true, visits: result.rows.map(row => ({ ...strip(row), Revision: row.__updateTime })), next: result.next };
    },
    async updateVisit(body) {
      requireCapability('visits.write'); const branchId = await branch(body);
      if (!['In progress', 'Completed', 'Cancelled'].includes(body.Status)) fail('Choose a valid reception status.');
      if (body.Status === 'Cancelled' && !clean(body.Reason)) fail('Enter the reason for cancelling this visit.');
      return operation(body, 'updateVisit', async key => {
        const row = await db.getDocument(env, collection('Visits'), id(body.VisitId));
        if (!row || row.BranchId !== branchId) fail('This visit is not available in the selected branch.', 404);
        if (body.Revision !== row.__updateTime || ['Completed', 'Cancelled'].includes(row.Status)) fail('Reload this visit before updating its status.', 409);
        if (['Completed','Cancelled'].includes(body.Status) && row.ClinicalState && row.ClinicalState !== 'Consultation signed') {
          fail('Clinical work is still open. The attending clinician must complete and sign the consultation before reception can close this visit.',409);
        }
        const person = await patient(row.PatientId, branchId);
        const lockId = await digest(JSON.stringify([branchId, row.PatientId]));
        const lock = await db.getDocument(env, collection('OpenVisits'), lockId);
        if (lock?.VisitId !== row.VisitId) fail('This is no longer the patient’s open visit. Reload the queue.', 409);
        const terminal = ['Completed', 'Cancelled'].includes(body.Status);
        const writes = [{ collectionPath: collection('Visits'), documentId: row.VisitId, currentDocument: condition(row),
          data: { ...strip(row), Status: body.Status, UpdatedAt: clock(), UpdatedBy: actor, ReceptionReason: clean(body.Reason).slice(0, 500) } },
        auditWrite(key, `Mark reception visit ${body.Status.toLowerCase()}`, branchId, person, { VisitId: row.VisitId })];
        if (terminal) writes.push({ collectionPath: collection('OpenVisits'), documentId: lockId,
          data: { VisitId: '', PatientId: row.PatientId }, currentDocument: condition(lock) });
        return { writes, result: { VisitId: row.VisitId, PatientId: row.PatientId } };
      });
    }
  };
}
