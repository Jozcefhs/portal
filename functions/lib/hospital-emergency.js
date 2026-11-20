import { observationTime, triageFields } from './hospital-clinical-model.js';
import { clean, digest, fail, id, patientName } from './hospital-model.js';

function reference(value) {
  const ref = clean(value).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{2,39}$/.test(ref)) fail('Enter a unique wristband or arrival reference of 3 to 40 letters, numbers or hyphens.');
  return ref;
}

export function createEmergencyReception({env, user, db, collection, branch, requireCapability, capabilities, operation, auditWrite, auditRead,
  clock, actor, patient, strip, condition, page}) {
  const arrivals = collection('EmergencyArrivals');
  const arrivalId = (branchId, ref) => digest(JSON.stringify([branchId, ref]));
  const create = (name, key, data) => ({collectionPath: collection(name), documentId: key, data, currentDocument: {exists: false}});
  const view = row => ({
    Reference: row.Reference, ArrivalNote: row.ArrivalNote, CreatedAt: row.CreatedAt, Status: row.Status,
    HospitalNumber: row.HospitalNumber || '', Revision: row.__updateTime
  });
  return {
    async visitEmergencyWristbands(body) {
      requireCapability('clinical.read');
      const branchId = await branch(body);
      const visit = await db.getDocument(env, collection('Visits'), id(body.VisitId));
      if (!visit || visit.BranchId !== branchId || visit.PatientId !== body.PatientId) fail('Visit unavailable for this patient and branch.', 404);
      await patient(visit.PatientId, branchId);
      const result = await page('EmergencyArrivals', [
        {field:'CareVisitId',op:'>=',value:visit.VisitId}, {field:'CareVisitId',op:'<=',value:visit.VisitId}
      ], 'CareVisitId', body);
      if (result.rows.some(row => row.BranchId !== branchId || row.PatientId !== visit.PatientId || row.VisitId !== visit.VisitId))
        fail('Emergency care linkage needs review.',409);
      return {ok:true, references:result.rows.map(row => row.Reference), next:result.next};
    },
    async emergencyCareHistory(body) {
      requireCapability('clinical.read');
      const branchId = await branch(body), ref = reference(body.Reference);
      const rid = await arrivalId(branchId,ref);
      const row = await db.getDocument(env,arrivals,rid);
      if (!row || row.BranchId !== branchId) fail('Wristband unavailable in this branch.',404);
      let person;
      if (row.Status === 'Identified') {
        if (row.VisitId !== body.VisitId || row.PatientId !== body.PatientId)
          fail('Open this patient’s identified visit to view emergency care.',409);
        person = await patient(row.PatientId,branchId);
      } else if (body.VisitId || body.PatientId) fail('This wristband is not linked to the selected visit.',409);
      let result = {rows:[],next:null};
      if (row.CareSequence) result = await page('EmergencyCareEntries', [
        {field:'TimelineKey',op:'>=',value:rid+'|'}, {field:'TimelineKey',op:'<',value:rid+'|~'}
      ], 'TimelineKey', body);
      if (result.rows.some(entry => entry.ArrivalId !== rid || entry.BranchId !== branchId)) fail('Emergency entry linkage needs review.',409);
      if (result.rows.length) await auditRead(body,'View signed emergency care',branchId,person,{ArrivalId:rid,VisitId:row.VisitId || ''});
      return {ok:true,sequence:row.CareSequence || 0,entries:result.rows.map(entry => ({
        EntryId:entry.EntryId,Type:entry.Type,Content:entry.Content,SignedAt:entry.SignedAt,AuthorName:entry.AuthorName
      })),next:result.next};
    },
    async signEmergencyCare(body) {
      requireCapability('clinical.read');
      if (body.Type === 'Triage') requireCapability('triage.write');
      else if (body.Type === 'Treatment') {
        if (!capabilities.includes('nursing.write')) requireCapability('consultations.write');
      } else fail('Choose triage or treatment.');
      const branchId = await branch(body), ref = reference(body.Reference);
      if (body.ConfirmedReference !== ref) fail('Confirm the wristband before signing.');
      const now = clock();
      let content;
      if (body.Type === 'Triage') content = triageFields(body.Content || {},now);
      else {
        const Treatment = clean(body.Content?.Treatment), Response = clean(body.Content?.Response);
        if (!Treatment || Treatment.length > 8000 || Response.length > 8000) fail('Record the treatment given. Each field allows up to 8,000 characters.');
        content = {Treatment,Response,ObservedAt:observationTime(body.Content?.ObservedAt,now)};
      }
      return operation(body,'signEmergencyCare',async key => {
        const rid = await arrivalId(branchId,ref);
        const row = await db.getDocument(env,arrivals,rid);
        if (!row || row.BranchId !== branchId) fail('Wristband unavailable in this branch.',404);
        if (row.Status !== 'Awaiting identification') fail('This arrival has been identified. Use the patient visit for further care.',409);
        const previous = row.CareSequence || 0;
        if (body.Sequence !== previous) fail('The wristband record changed. Refresh its signed entries before signing.',409);
        const sequence = previous + 1;
        const entry = {EntryId:key,ArrivalId:rid,BranchId:branchId,Reference:ref,Sequence:sequence,
          TimelineKey:rid+'|'+String(sequence).padStart(12,'0'),Type:body.Type,Content:content,
          AuthorUsername:actor,AuthorName:clean(user.displayName)||actor,SignedAt:now};
        return {writes:[create('EmergencyCareEntries',key,entry),
          {collectionPath:arrivals,documentId:rid,currentDocument:condition(row),data:{...strip(row),CareSequence:sequence}},
          auditWrite(key,'Sign emergency '+body.Type.toLowerCase(),branchId,{}, {EntityType:'Emergency arrival',EntityId:rid,EntryId:key})],
          result:{EntryId:key,Sequence:sequence}};
      });
    },
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
            CreatedAt:row.CreatedAt, UpdatedAt:now, CreatedBy:actor, EmergencyReference:ref,
            ...(row.CareSequence ? {HasPreIdentificationCare:true} : {})}));
        } else if (row.CareSequence) {
          const visit = await db.getDocument(env,collection('Visits'),visitId);
          if (!visit || visit.PatientId !== person.PatientId || visit.BranchId !== branchId)
            fail('Review the open visit before linking emergency care.',409);
          if (!visit.HasPreIdentificationCare) writes.push({collectionPath:collection('Visits'),documentId:visitId,
            currentDocument:condition(visit),data:{...strip(visit),HasPreIdentificationCare:true}});
        }
        writes.push({collectionPath:collection('OpenVisits'),documentId:guardId,currentDocument:condition(guard),
          data:{...strip(guard),VisitId:visitId,PatientId:person.PatientId,LastEmergencyReference:ref}},
          {collectionPath:collection('Patients'),documentId:person.PatientId,currentDocument:condition(person),
            data:{...strip(person),LastEmergencyArrivalId:rid}},
          {collectionPath:arrivals,documentId:rid,currentDocument:condition(row),
            data:{...strip(row),Status:'Identified',PendingKey:'',PatientId:person.PatientId,HospitalNumber:person.HospitalNumber,
              VisitId:visitId,...(row.CareSequence ? {CareVisitId:visitId} : {}),IdentityEvidence:evidence,IdentifiedAt:now,IdentifiedBy:actor}},
          auditWrite(key,'Identify emergency arrival',branchId,person,{Reference:ref,VisitId:visitId,ArrivalId:rid,IdentityEvidence:evidence}));
        return {writes,result:{VisitId:visitId,HospitalNumber:person.HospitalNumber,ReusedVisit:Boolean(guard?.VisitId)}};
      });
    }
  };
}
