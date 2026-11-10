import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {searchLibraryBorrowers} from '../functions/lib/school-library.js';
import {summarizeWalletActivity} from '../functions/api/backend.js';

const tuckSource=(await readFile(new URL('../functions/lib/school-tuck-shop.js',import.meta.url),'utf8'))
  .replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const backend=await readFile(new URL('../functions/api/backend.js',import.meta.url),'utf8');
const walletSource=backend.slice(backend.indexOf('async function walletActivityForAccount('),backend.indexOf('\nasync function accountCreditBalanceForAccount('));
const clean=value=>String(value??'').trim();

test('fuzzy customer search reads only the permitted branch roster, never payment history, and is read-only at 2 and 2,000 pupils',async()=>{
  for(const count of [2,2000]) {
    const pupils=Array.from({length:count},(_,i)=>({AdmissionNo:`TEST/26/${i}`,DisplayName:`Synthetic learner ${i}`,ClassName:'Grade 7',BranchId:'main',SchoolSection:'secondary'}));
    const reads=[];
    const api=runInNewContext(`${tuckSource}\n({searchTuckShopCustomers})`,{
      searchLibraryBorrowers,schoolSectionFor:row=>row.SchoolSection,
      listSchoolCollection:async(_env,collection,options)=>{reads.push({collection,options,rows:pupils.length});return pupils;},
      listBranchCollection:async()=>{throw new Error('Unexpected staff read');}
    });
    const before=JSON.stringify(pupils),user={branchId:'main',schoolSectionAccess:'secondary'};
    assert.equal((await api.searchTuckShopCustomers({},user,{Query:'S'})).customers.length,0);assert.equal(reads.length,0);
    const result=await api.searchTuckShopCustomers({},user,{Query:'Synthetic'});
    assert.equal(reads.length,1);assert.equal(reads[0].rows,count);assert.equal(reads[0].collection,'students');
    assert.deepEqual({...reads[0].options},{branchId:'main',schoolSectionAccess:'secondary'});
    assert.ok(result.customers.length>0);
    assert.ok(result.customers.every(row=>Object.keys(row).sort().join(',')==='CustomerName,CustomerRef,CustomerType,Detail'));
    assert.equal(JSON.stringify(pupils),before);
  }
});

test('authoritative wallet balance uses one lifetime query at 2 and 2,000 entries and includes older refunds without writes',async()=>{
  for(const count of [2,2000]) {
    const scope={AccountRef:'TEST/26/001',BranchId:'main',SchoolSection:'secondary'};
    const rows=[{...scope,LedgerNo:'opening',Date:'2025-01-01',FeeCategory:'Wallet',EntryType:'Wallet Deposit',Credit:10000,Debit:0},
      { ...scope,LedgerNo:'refund',Date:'2025-02-01',FeeCategory:'Wallet',EntryType:'Wallet Refund',Credit:500,Debit:0},
      ...Array.from({length:count-2},(_,i)=>({...scope,LedgerNo:`spend-${i}`,Date:'2025-03-01',FeeCategory:'Wallet',EntryType:'Wallet Purchase',Credit:0,Debit:1}))];
    const calls=[],before=JSON.stringify(rows);
    const wallet=runInNewContext(`${walletSource}\nwalletActivityForAccount`,{clean,summarizeWalletActivity,schoolSectionFor:row=>row.SchoolSection,
      queryAccountRows:async(_env,collection,accountRef,financialScope,options)=>{calls.push({collection,accountRef,financialScope,options,rows:rows.length});return rows;}
    });
    const result=await wallet({},scope.AccountRef,scope);
    assert.equal(calls.length,1);assert.equal(calls[0].rows,count);assert.equal(calls[0].collection,'ledger');
    assert.equal(calls[0].options.strict,true);assert.equal(result.balance,10500-(count-2));
    assert.equal(JSON.stringify(rows),before);
  }
});
