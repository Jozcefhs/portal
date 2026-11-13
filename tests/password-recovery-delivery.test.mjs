import test from 'node:test';
import assert from 'node:assert/strict';
import {deliverPasswordRecovery} from '../functions/lib/password-recovery-delivery.js';

test('accepted recovery sends once and stores only receipt metadata without overwriting concurrent consumption',async()=>{
  let sends=0;const writes=[];
  const row={UsedAt:'consumed',Fingerprint:'unchanged'};
  await deliverPasswordRecovery({},'parentPasswordRecovery','hash',{textContent:'secret-code'}, {
    sendConfiguredEmail:async()=>{sends++;return {ok:true,provider:'brevo',providerMessageId:'receipt-1'};},
    batchCommitLiteralDocuments:async(_env,items)=>{writes.push(...items);Object.assign(row,items[0].data);}
  });
  assert.equal(sends,1);assert.equal(writes.length,1);assert.equal(writes[0].exists,true);
  assert.equal(row.UsedAt,'consumed');assert.equal(row.Fingerprint,'unchanged');
  assert.equal(row.DeliveryStatus,'Accepted');assert.equal(row.DeliveryMessageId,'receipt-1');
  assert.ok(!JSON.stringify(writes).includes('secret-code'));
  assert.deepEqual(writes[0].updateMask,Object.keys(writes[0].data));
});

test('provider rejection and uncertain acceptance are distinguishable and never automatically resent',async()=>{
  for(const retrySafe of [true,false]){
    let sends=0,receipt;
    const error=Object.assign(Error('Private provider response'),{provider:'brevo',code:'BREVO_CREDIT_EXHAUSTED',retrySafe});
    await assert.rejects(deliverPasswordRecovery({},'staffPasswordRecovery','hash',{}, {
      sendConfiguredEmail:async()=>{sends++;throw error;},
      batchCommitLiteralDocuments:async(_env,writes)=>{receipt=writes[0].data;}
    }),e=>e===error);
    assert.equal(sends,1);assert.equal(receipt.DeliveryStatus,retrySafe?'Rejected':'Unconfirmed');
    assert.equal(receipt.DeliveryFailureCode,'BREVO_CREDIT_EXHAUSTED');
    assert.ok(!JSON.stringify(receipt).includes(error.message));
  }
});

test('unknown failure details and failed receipt writes never leak secrets or resend a code',async()=>{
  let sends=0,receipt;
  await assert.rejects(deliverPasswordRecovery({},'staffPasswordRecovery','hash',{}, {
    sendConfiguredEmail:async()=>{sends++;throw Object.assign(Error('private'),{code:'secret@example.com',provider:'private'});},
    batchCommitLiteralDocuments:async(_env,writes)=>{receipt=writes[0].data;throw Error('unavailable');}
  }));
  assert.equal(sends,1);assert.equal(receipt.DeliveryStatus,'Unconfirmed');
  assert.equal(receipt.DeliveryFailureCode,'EMAIL_DELIVERY_UNCONFIRMED');assert.equal(receipt.DeliveryProvider,'');
  const delivery=await deliverPasswordRecovery({},'staffPasswordRecovery','hash',{}, {
    sendConfiguredEmail:async()=>({ok:true,provider:'gmail',providerMessageId:'gmail-id'}),
    batchCommitLiteralDocuments:async()=>{throw Error('unavailable');}
  });
  assert.equal(delivery.providerMessageId,'gmail-id');
});
