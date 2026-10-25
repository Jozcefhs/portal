import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {accountingChartForEdition} from '../functions/lib/accounting-edition-scope.js';
import {DEFAULT_GIVING_TYPES, resolveGivingType} from '../functions/lib/church-funds.js';
import {resolveOrganizationConfig} from '../functions/lib/organization-config.js';
import {incomeAccountForEdition, incomeCategoryForEdition, legacyIncomeCategoryName} from '../functions/lib/organization-income-labels.js';

test('organisation default labels preserve identifiers, customised names and faith terminology',()=>{
  const legacy=DEFAULT_GIVING_TYPES.map(row=>({...row,RevenueAccountName:`${row.Name} Income`}));
  const snapshot=structuredClone(legacy);
  const chart=legacy.map(row=>({Code:row.RevenueAccountCode,Name:row.RevenueAccountName,Type:'Revenue',Group:'Giving Income'}));
  const labels=legacy.map(row=>incomeCategoryForEdition(row,'organization'));
  const accounts=accountingChartForEdition(chart,'organization');
  assert.equal(labels[2].Name,'Regular Contribution');
  assert.equal(accounts[3].Name,'Programme Contribution Income');
  assert.deepEqual(labels.map(row=>[row.GivingTypeId,row.RevenueAccountCode]),legacy.map(row=>[row.GivingTypeId,row.RevenueAccountCode]));
  assert.deepEqual(legacy,snapshot);
  for(const row of legacy){
    assert.equal(resolveGivingType(labels,row.Name).RevenueAccountCode,row.RevenueAccountCode);
    assert.deepEqual(incomeCategoryForEdition(row,'faith'),row);
  }
  assert.deepEqual(accountingChartForEdition(chart,'faith'),chart);
  const custom={Code:'4160',Name:'Annual membership subscriptions',Group:'Membership income'};
  assert.deepEqual(incomeAccountForEdition(custom,'organization'),custom);
  const hotel={Code:'4150',Name:'Hotel Services Revenue'};
  assert.deepEqual(incomeAccountForEdition(hotel,'organization'),hotel);
  const customType={...legacy[2],Name:'Subscription'};
  assert.deepEqual(incomeCategoryForEdition(customType,'organization'),customType);
});

async function seedFixture(edition,existing=false){
  const source=await readFile(new URL('../functions/lib/church-funds.js',import.meta.url),'utf8');
  const types=existing?DEFAULT_GIVING_TYPES.map(row=>({...row,RevenueAccountName:'Old cached name'})):[];
  const chart=existing?DEFAULT_GIVING_TYPES.map(row=>({Code:row.RevenueAccountCode,Name:`${row.Name} Income`,Group:'Giving Income'})):[];
  if(existing){types[0].Name='Our annual subscription';chart[0].Name='Our subscription revenue';}
  const before=structuredClone({types,chart}),writes=[];
  const {ensureGivingTypes}=vm.runInNewContext(source.replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/\bexport /g,'')+'\n({ensureGivingTypes})',{
    resolveOrganizationConfig,incomeAccountForEdition,incomeCategoryForEdition,legacyIncomeCategoryName,
    CHURCH_COLLECTIONS:{givingTypes:'types'},churchCollectionPath:(_path,branch)=>`types/${branch}`,
    resolveMembershipBranch:(_user,branch)=>branch,safeChurchDocumentId:id=>id,
    listCollection:async(_env,path)=>structuredClone(path==='chartOfAccounts'?chart:types),
    upsertDocument:async(_env,path,id,row)=>writes.push({path,id,row})
  });
  const result=await ensureGivingTypes({ORGANISATION_EDITION:edition},'area-1');
  return {result:JSON.parse(JSON.stringify(result)),writes,before,after:{types,chart}};
}

test('fresh organisation categories use neutral defaults; existing records are never rewritten during reads',async()=>{
  const fresh=await seedFixture('organization');
  assert.equal(fresh.writes.length,18);
  assert.ok(fresh.result.givingTypes.some(row=>row.Name==='Programme Contribution'));
  assert.ok(fresh.result.chart.every(row=>row.Group==='Contribution Income'));
  const existing=await seedFixture('organization',true);
  assert.equal(existing.writes.length,0);
  assert.deepEqual(existing.after,existing.before);
  const custom=existing.result.givingTypes.find(row=>row.GivingTypeId==='OFFERING');
  assert.equal(custom.Name,'Our annual subscription');
  assert.equal(custom.RevenueAccountName,'Our subscription revenue');
  assert.equal(existing.result.givingTypes.find(row=>row.GivingTypeId==='TITHE').RevenueAccountName,'Regular Contribution Income');
  const faith=await seedFixture('faith');
  assert.ok(faith.result.givingTypes.some(row=>row.Name==='Tithe'));
});

test('school fee report is not mounted or queried for faith and organisation workspaces',async()=>{
  const source=await readFile(new URL('../js/admin.js',import.meta.url),'utf8');
  const start=source.indexOf('function mountFeeCollectionSummary(');
  const end=source.indexOf('\nfunction mountClubMemberRegister',start);
  for(const edition of ['faith','organization','school']){
    let mounted=0,appended=0;
    const fn=vm.runInNewContext(source.slice(start,end)+'\nmountFeeCollectionSummary',{
      currentUser:{edition},resolveDashboardEdition:user=>user.edition,staffFetch:()=>{throw new Error('Must not fetch on mount');},
      document:{createElement:()=>({})},window:{DynamaxFeeCollectionSummary:{mount:()=>mounted++}}
    });
    const result=fn({append:()=>appended++});
    assert.equal(mounted,edition==='school'?1:0);
    assert.equal(appended,mounted);
    if(edition!=='school')assert.equal(result,null);
  }
});
