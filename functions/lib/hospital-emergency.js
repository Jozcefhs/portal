import { clean, digest, fail, patientName } from './hospital-model.js';

function reference(value) {
  const ref = clean(value).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{2,39}$/.test(ref)) fail('Enter a unique wristband or arrival reference of 3 to 40 letters, numbers or hyphens.');
  return ref;
}

export function createEmergencyReception({env, db, collection, branch, requireCapability, operation, auditWrite,
  clock, actor, patient, strip, condition, page}) {
  const arrivals = collection('EmergencyArrivals');
  const arrivalId = (branchId, ref) => digest(JSON.stringify([branchId, ref]));
  const create = (name, key, data) => ({collectionPath: collection(name), documentId: key, data, currentDocument: {exists: false}});
  const view = row => ({
    Reference: row.Reference, ArrivalNote: row.ArrivalNote, CreatedAt: row.CreatedAt, Status: row.Status,
    HospitalNumber: row.HospitalNumber || '', Revision: row.__updateTime
  });
  return {
    async emergencyArrivals(body) {
      requireCapability('visits.read');
      const branchId = await branch(body);
      if (clean(body.Reference)) {
        const row = await db.getDocument(env, arrivals, await arrivalId(branchId, reference(body.Reference)));
        return {ok: true, arrivals: row ? [view(row)] : [], next: null};
      }
      const prefix = branchId + '|';
      const result = await page('EmergencyArrivals', [
        {field:'PendingKey', op:'>=', value:prefix}, {field:'PendingKey', op:'<', value:prefix+'~'}
      ], 'PendingKey', body);
      return {ok:true, arrivals:result.rows.map(view), next:result.next};
    },
    async recordEmergencyArrival(body) {
      requireCapability('visits.write');
      const branchId = await branch(body);
      const ref = reference(body.Reference);
      const note = clean(body.ArrivalNote);
      if (!note || note.length > 300) fail('Enter a brief arrival description of up to 300 characters.');
      return operation(body, 'recordEmergencyArrival', async key => {
        const rid = await arrivalId(branchId, ref);
        const existing = await db.getDocument(env, arrivals, rid);
        if (existing) {
          if (existing.ArrivalNote !== note) fail('This wristband reference already has an arrival. Find it by reference.', 409);
          return {writes:[], result:{Reference:ref, Status:existing.Status, Unchanged:true}};
        }
        const now = clock();
        const record = {BranchId:branchId, Reference:ref, ArrivalNote:note, CreatedAt:now, CreatedBy:actor,
          Status:'Awaiting identification', PendingKey:branchId+'|'+now+'|'+ref};
        return {writes:[create('EmergencyArrivals',rid,record),
          auditWrite(key,'Record emergency arrival',branchId,{}, {EntityType:'Emergency arrival',EntityId:rid,Reference:ref})],
          result:{Reference:ref, Status:record.Status}};
      });
    },
    async identifyEmergencyArrival(body) {
      requireCapability('visits.write');
      requireCapability('patients.write');
      const branchId = await branch(body);
      const ref = reference(body.Reference);
      const evidence = clean(body.IdentityEvidence);
      if (evidence.length < 5 || evidence.length > 300) fail('Record how the patient identity was verified (5 to 300 characters).');
      return operation(body, 'identifyEmergencyArrival', async key => {
        const rid = await arrivalId(branchId, ref);
        const row = await db.getDocument(env, arrivals, rid);
        if (!row) fail('Arrival not found in this branch.',404);
        if (row.Status === 'Identified') {
          if (row.PatientId !== body.PatientId || row.HospitalNumber !== body.HospitalNumber) fail('This arrival is already linked to another patient.',409);
          return {writes:[], result:{VisitId:row.VisitId, HospitalNumber:row.HospitalNumber, Unchanged:true}};
        }
        if (row.__updateTime !== body.Revision) fail('Reload the arrival before confirming identity.',409);
        const person = await patient(body.PatientId,branchId);
        if (person.Status !== 'Active' || person.HospitalNumber !== body.HospitalNumber || person.__updateTime !== body.PatientRevision)
          fail('Reload and verify the selected patient before continuing.',409);
        const guardId = await digest(JSON.stringify([branchId, person.PatientId]));
        const guard = await db.getDocument(env,collection('OpenVisits'),guardId);
        const visitId = guard?.VisitId || key;
        const now = clock();
        const writes = [];
        if (!guard?.VisitId) {
          writes.push(create('Visits',visitId,{VisitId:visitId, PatientId:person.PatientId, PatientName:patientName(person),
            HospitalNumber:person.HospitalNumber, BranchId:branchId, Department:'Emergency', Status:'Waiting',
            CreatedAt:row.CreatedAt, UpdatedAt:now, CreatedBy:actor, EmergencyReference:ref}));
        }
        writes.push({collectionPath:collection('OpenVisits'),documentId:guardId,currentDocument:condition(guard),
          data:{...strip(guard),VisitId:visitId,PatientId:person.PatientId,LastEmergencyReference:ref}},
          {collectionPath:collection('Patients'),documentId:person.PatientId,currentDocument:condition(person),
            data:{...strip(person),LastEmergencyArrivalId:rid}},
          {collectionPath:arrivals,documentId:rid,currentDocument:condition(row),
            data:{...strip(row),Status:'Identified',PendingKey:'',PatientId:person.PatientId,HospitalNumber:person.HospitalNumber,
              VisitId:visitId,IdentityEvidence:evidence,IdentifiedAt:now,IdentifiedBy:actor}},
          auditWrite(key,'Identify emergency arrival',branchId,person,{Reference:ref,VisitId:visitId,ArrivalId:rid,IdentityEvidence:evidence}));
        return {writes,result:{VisitId:visitId,HospitalNumber:person.HospitalNumber,ReusedVisit:Boolean(guard?.VisitId)}};
      });
    }
  };
}
