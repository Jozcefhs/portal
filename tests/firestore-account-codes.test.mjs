import test from 'node:test';
import assert from 'node:assert/strict';
import { objectToFirestoreFields, firestoreDocumentToObject } from '../functions/lib/firestore.js';

const roundTrip = data => firestoreDocumentToObject({ fields: objectToFirestoreFields(data) });

test('account mappings remain text identifiers on saves in every edition, including nested snapshots', () => {
  for (const edition of ['school', 'faith', 'organization']) {
    const mappings = { PayableAccount:'2000', CommissionAccount:4090, VendorReceivableAccount:'1110',
      ExpenseAccount:'6090', PaymentAccount:'1020', SalaryExpenseAccount:'6000', CustomAccount:'0012', OffsetAccount:'REV-A' };
    const row = roundTrip({ OrganisationEdition:edition, ...mappings, AccountsSnapshot:mappings, Lots:[mappings] });
    for (const [key, value] of Object.entries(mappings)) {
      assert.equal(row[key], String(value));
      assert.equal(row.AccountsSnapshot[key], String(value));
      assert.equal(row.Lots[0][key], String(value));
    }
  }
});

test('legacy integer account mappings are normalized only on read without changing source documents', () => {
  const fields = { PayableAccount:{integerValue:'2000'}, CommissionAccount:{doubleValue:4090},
    AccountsSnapshot:{mapValue:{fields:{VendorReceivableAccount:{integerValue:'1110'}}}},
    Lots:{arrayValue:{values:[{mapValue:{fields:{PayableAccount:{integerValue:'2100'}}}}]}} };
  const before = structuredClone(fields);
  const row = firestoreDocumentToObject({ fields });
  assert.equal(row.PayableAccount, '2000'); assert.equal(row.CommissionAccount, '4090');
  assert.equal(row.AccountsSnapshot.VendorReceivableAccount, '1110');
  assert.equal(row.Lots[0].PayableAccount, '2100');
  assert.deepEqual(fields, before);
});

test('money and vendor minor units stay numeric rather than inheriting identifier/string rules', () => {
  const data = { Amount:170900, Debit:'170900', Credit:0, Balance:42.5, AccountBalance:12.5,
    GrossCents:17090000, PaidCents:0, ReservedCents:0, FixedCents:2500, Enabled:true,
    AccountsSnapshot:{PayableAccount:'2000'}, Allocations:[{PaidCents:4000, ReservedCents:9000}] };
  const row = roundTrip(data);
  for (const key of ['Amount','Debit','Credit','Balance','AccountBalance','GrossCents','PaidCents','ReservedCents','FixedCents']) {
    assert.equal(typeof row[key], 'number', key); assert.equal(row[key], Number(data[key]), key);
  }
  assert.equal(row.Allocations[0].PaidCents,4000); assert.equal(row.Allocations[0].ReservedCents,9000);
  assert.equal(row.Enabled,true); assert.equal(row.AccountsSnapshot.PayableAccount,'2000');
  const old = firestoreDocumentToObject({fields:{PaidCents:{stringValue:'4000'}, FixedCents:{stringValue:'2500'}}});
  assert.equal(old.PaidCents,4000); assert.equal(old.FixedCents,2500);
});
