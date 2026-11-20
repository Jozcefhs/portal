import { schoolSectionFor } from './school-scope.js';
import { getDocument, batchCommitLiteralDocuments, queryCollection } from './firestore.js';
import { actor, clean, lower, plain, fail, id, scopeFor, role, sameScope, vendorOwned, units, quantity,
  DEPARTMENTS, inventoryAllowed, schoolSectionsFor } from './procurement-rules.js';
import { findStaffUserRecord, staffAccessFor } from './staff-auth.js';
import { assignedStaffBranches } from './staff-branch-access.js';
import { PROCUREMENT_COLLECTIONS as P, handleProcurementAction } from './procurement.js';

const slips = 'storekeepingHandovers', events = 'storekeepingMovements';
const conditions = ['Available', 'Needs repair', 'Damaged', 'Awaiting disposal'];
function field(value, name, limit = 160) {
  const result = clean(value);
  if (!result || result.length > limit) fail('Enter a valid ' + name + '.');
  return result;
}
async function digest(parts) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts)));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
function stock(row) {
  const value = Number(row.Quantity);
  if (!Number.isFinite(value) || Math.abs(value - Math.round(value * 1000) / 1000) > 0.0000001) fail('Review the saved stock quantity.', 409);
  return units(Math.round(value * 1000) / 1000, 'Stock quantity', true);
}
export async function handleStorekeeping(env, user, body, dependencies = {}) {
  const { get = getDocument, page = queryCollection, commit = batchCommitLiteralDocuments } = dependencies;
  const scope = scopeFor(user, 'storekeeping'), who = actor(user), action = clean(body.action);
  if (lower(body.BranchId) !== scope.BranchId) fail('Reopen Storekeeping in your selected branch.', 409);
  const keeper = user.storekeepingManager === true;
  const readOnly = user.subscriptionReadOnly === true || user.subscriptionActive === false;
  const read = async (collection, key) => {
    const row = await get(env, collection, id(key));
    if (!sameScope(row, scope)) fail('Record unavailable in this branch.', 404);
    return row;
  };
  const itemFor = async key => {
    const item = await read(P.items, key);
    if (vendorOwned(item)) fail('Select organisation-owned stock.', 403);
    return item;
  };
  const permitted = row => keeper || row.Recipient === who || row.CreatedByUsername === who;
  if (action === 'access') return { keeper, username: who, readOnly, sections:schoolSectionsFor(user,scope) };
  if (action === 'requests' || action === 'issueRequest') {
    if (!keeper) fail('Branch storekeeper access is required.',403);
    if (action === 'requests') {
      const result = await handleProcurementAction(env,user,{ action:'records',Kind:'requests',Mode:'active',
        Cursor:body.Cursor || null,SchoolSection:body.SchoolSection },dependencies,'storekeeping');
      return { rows:result.records.filter(row => ['APPROVED','PARTIALLY_ISSUED'].includes(row.Status)), cursor:result.paging.nextCursor };
    }
    return handleProcurementAction(env,user,{ action:'issue',RequisitionId:body.RequisitionId,
      RequestId:body.RequestId,ExpectedRevision:body.ExpectedRevision,Notes:body.Notes,Lines:body.Lines },dependencies,'storekeeping');
  }
  if (['stock','purchases','handovers','mine','sent','card'].includes(action)) {
    if (!keeper && !['mine','sent'].includes(action)) fail('Branch storekeeper access is required.', 403);
    const by = action === 'sent' ? ['SenderKey',scope.ScopeKey+'/'+who] : action === 'mine' ? ['RecipientKey', scope.ScopeKey + '/' + who]
      : action === 'card' ? ['ItemKey', scope.ScopeKey + '/' + id(body.ItemId)] : ['ScopeKey', scope.ScopeKey];
    const collection = action === 'purchases' ? P.purchases : action === 'stock' ? P.items : action === 'card' ? events : slips;
    const anchor = body.Cursor ? await read(collection, body.Cursor) : null;
    if (anchor && anchor[by[0]] !== by[1]) fail('Choose a cursor from this list.');
    const rows = await page(env, collection, { filters: [{ field:by[0], op:'==', value:by[1] }],
      ...(action === 'purchases' ? { select:['ScopeKey','BranchId','OrganisationEdition','PurchaseId','Status','Reference','Lines'] } : {}),
      orderBy:[{ field:'__name__', direction:'ASCENDING' }], limit:101, ...(anchor ? { startAfterName:anchor.__name } : {}) });
    const slice = rows.slice(0,100);
    if (action === 'purchases') return { rows:slice.filter(r => sameScope(r,scope)).flatMap(row => (row.Lines || [])
      .filter(line => Number(line.ReceivedQuantity)>0).map(line=>({ PurchaseId:row.PurchaseId,Reference:row.Reference || row.PurchaseId,
        ItemId:line.ItemId,ItemName:line.ItemName,Unit:line.Unit,Quantity:line.ReceivedQuantity }))),
      cursor:rows.length>100?slice.at(-1).__id:'' };
    return { rows:slice.filter(r => sameScope(r,scope) && r[by[0]] === by[1] && !vendorOwned(r)).map(r => action === 'stock'
      ? { ItemId:r.ItemId, ItemName:r.ItemName, Unit:r.Unit, Quantity:r.Quantity } : plain(r)),
      cursor:rows.length > 100 ? slice.at(-1).__id : '' };
  }
  if (readOnly) fail('This subscription is read-only.', 403);
  if (!['issue','return','replace','accept','cancel'].includes(action)) fail('Unknown Storekeeping action.');
  if (action === 'issue' && !keeper) fail('Only a branch storekeeper can dispatch stock.',403);
  const writes = [], now = new Date().toISOString();
  function save(collectionPath, documentId, data, previous) {
    if (previous && !previous.__updateTime) fail('Refresh the record before saving.', 409);
    writes.push({ collectionPath, documentId, data:plain(data), ...(previous ? { updateTime:previous.__updateTime } : { exists:false }) });
  }
  function changeStock(collection, key, row, delta) {
    const after = stock(row) + delta;
    const Quantity = quantity(after);
    units(Quantity, 'Resulting stock', true);
    save(collection, key, { ...row, Quantity, Revision:Number(row.Revision || 0)+1, UpdatedAt:now, LastUpdated:now, UpdatedBy:who }, row);
  }
  const finalizing = action === 'accept' || action === 'cancel';
  const Reference = finalizing ? '' : field(body.Reference,'handover slip reference',80);
  const SlipId = finalizing ? id(body.SlipId) : 'SK-' + await digest([scope.ScopeKey,lower(Reference)]);
  const existing = await get(env, slips, SlipId);
  if (existing && !sameScope(existing,scope)) fail('Invalid handover.',403);
  const fingerprint = await digest([action,who,...['ItemId','Quantity','Recipient','Destination','DestinationType','SourceId','PurchaseId','AssetTag','Condition','Notes'].map(k => clean(body[k]))]);
  const result = { ok:true, SlipId };
  function replay(row) {
    if (!row || !sameScope(row,scope)) return false;
    if (finalizing) return row.Status === (action === 'accept' ? 'Accepted' : 'Cancelled') && row.ClosedBy === who;
    return row.Fingerprint === fingerprint;
  }
  if (replay(existing)) return { ...result, replayed:true };
  if (existing && !finalizing) fail('This slip reference already belongs to another handover.',409);
  if (finalizing && (!existing || !permitted(existing) || existing.Status !== 'In transit')) fail('This handover is unavailable or already closed.',409);

  let transfer, movement, item;
  // A source handover holds only the quantity still physically in its recipient’s custody.
  // Reservations and closures use the same versioned write as stock and the audit entry.
  async function adjustSource(key, amount, fieldName) {
    const source = await read(slips,key);
    const balance = units(source[fieldName] ?? 0,fieldName,true) + amount;
    units(quantity(balance),fieldName,true);
    save(slips,key,{ ...source,[fieldName]:quantity(balance) },source);
    return source;
  }
  async function linkedInventory(link) {
    const cfg = DEPARTMENTS[link.Department];
    if (!cfg) fail('Invalid receiving department.');
    const row = await get(env,cfg.Collection,id(link.InventoryId));
    if ((scope.OrganisationEdition === 'school' && schoolSectionFor(row || {}) !== lower(link.SchoolSection)) || !inventoryAllowed(row,link.Department,user,scope) || row.ProcurementItemId !== item.ItemId
        || lower(row.Unit || cfg.Unit) !== lower(item.Unit)
        || (scope.OrganisationEdition === 'school' && !schoolSectionsFor(user,scope).includes(link.SchoolSection))) fail('The original departmental stock link needs review.',409);
    return { cfg,row };
  }
  async function changeDepartment(link,delta) {
    const { cfg,row } = await linkedInventory(link);
    changeStock(cfg.Collection,link.InventoryId,row,delta);
    if (cfg.Movements) save(cfg.Movements,SlipId+'-'+action,{ ...scope, SchoolSection:link.SchoolSection,
      MovementNo:SlipId+'-'+action, Date:now, Timestamp:now, ItemName:item.ItemName, InventoryId:link.InventoryId,
      Type:delta>0?'IN':'OUT', MovementType:delta>0?'IN':'OUT', Quantity:quantity(Math.abs(delta)), Unit:item.Unit,
      Before:quantity(stock(row)), After:quantity(stock(row)+delta), Source:'Storekeeping', Reason:action+' '+SlipId, RecordedBy:who });
  }
  async function adjustProcurementReturn(sourceId,delta) {
    const source = await read(P.transfers,sourceId);
    const line = source.Lines.find(l => l.ItemId === item.ItemId);
    if (!line) fail('The original delivery did not include this item.');
    const returned = units(line.StoreReturnedQuantity || 0,'Previously returned',true) + delta;
    if (returned < 0 || returned > units(line.ReceivedQuantity || 0,'Received quantity',true)) fail('Return exceeds the quantity received on the delivery.',409);
    const Link = { Department:source.Department, SchoolSection:source.SchoolSection, InventoryId:line.InventoryId };
    await changeDepartment(Link,-delta);
    save(P.transfers,sourceId,{ ...source, Revision:source.Revision+1, UpdatedAt:now, UpdatedBy:who,
      Lines:source.Lines.map(l=>l===line?{ ...l,StoreReturnedQuantity:quantity(returned) }:l) },source);
    return Link;
  }
  try {
    if (!finalizing) {
      const amount = units(body.Quantity), SourceId = clean(body.SourceId), PurchaseId = clean(body.PurchaseId);
      const Recipient = lower(field(body.Recipient,'recipient staff username'));
      const recipientAccount = await (dependencies.findStaff || findStaffUserRecord)(env,Recipient,{ allowListFallback:false });
      const branches = recipientAccount && assignedStaffBranches(recipientAccount);
      if (!recipientAccount || (branches && !branches.includes(scope.BranchId)) || ['no','false','0','inactive','disabled'].includes(lower(recipientAccount.Active))
          || ['Vendor User','External Auditor','Auditor'].includes(role(recipientAccount))) fail('Choose an active staff username in this branch.');
      if (Recipient === who) fail('Choose another staff member to acknowledge the handover.');
      item = await itemFor(body.ItemId);
      let Destination = field(body.Destination,'destination'), DestinationType = clean(body.DestinationType) || 'Department';
      let Condition = 'Available', Link = null, origin = 'Central store';
      let AssetTag = clean(body.AssetTag);
      if (AssetTag.length > 100 || (AssetTag && amount !== 1000)) fail('Record one unit per asset tag.');
      if (action === 'return' || (action === 'issue' && SourceId)) {
        if (!SourceId) fail('Select the original handover.');
        if (SourceId.startsWith('TRF-')) {
          if (action !== 'return' || !keeper) fail('A branch storekeeper must receive returns from Procurement deliveries.',403);
          Link = await adjustProcurementReturn(SourceId,amount);
          origin = Link.Department;
        } else {
          const source = await adjustSource(SourceId,-amount,'HeldQuantity');
          if (source.Status !== 'Accepted' || source.Kind === 'return' || source.ItemId !== item.ItemId
              || (source.Recipient !== who && !keeper)) fail('This item is unavailable from the selected holder.',403);
          if (action === 'issue' && source.DestinationType !== 'Store') fail('Select stock held in a store.');
          origin = source.Destination;
          if (source.AssetTag && AssetTag && AssetTag !== source.AssetTag) fail('The tag differs from the original issue.');
          AssetTag = source.AssetTag || AssetTag;
          Link = source.Link || null;
          if (Link) await changeDepartment(Link,-amount);
        }
        if (action === 'return') {
          Condition = field(body.Condition,'return condition');
          if (!conditions.includes(Condition)) fail('Choose a valid return condition.');
          Destination = 'Central store'; DestinationType = 'Store';
        }
      } else {
        if (!keeper) fail('Only a branch storekeeper can dispatch central stock.',403);
        if (amount > stock(item)) fail('Insufficient available stock.',409);
        changeStock(P.items,item.ItemId,item,-amount);
        if (action === 'replace') {
          const source = await adjustSource(SourceId,-amount,'ReplacementRemaining');
          if (source.Status !== 'Accepted' || source.Kind !== 'return' || source.ItemId !== item.ItemId) fail('Select a matching accepted return.',409);
          Destination = source.Origin; DestinationType = source.OriginType || 'Department'; Link = source.Link || null;
        }
      }
      if (DestinationType === 'Store') {
        const access = await (dependencies.recipientAccess || staffAccessFor)(env,{ ...recipientAccount,
          username:Recipient, role:role(recipientAccount), branchId:scope.BranchId });
        if (!access.allowedSections?.includes('storekeeping')) fail('Choose a branch storekeeper to accept custody.',403);
      }
      if (!['Department','Store'].includes(DestinationType)) fail('Choose department or store.');
      if (PurchaseId) {
        if (SourceId || action !== 'issue') fail('Only central dispatches can allocate a supplier receipt.');
        const purchase = await read(P.purchases,PurchaseId);
        const line = purchase.Lines.find(l=>l.ItemId===item.ItemId);
        const allocationKey = await digest([scope.ScopeKey,PurchaseId,item.ItemId]);
        const previous = await get(env,'storekeepingAllocations',allocationKey);
        const allocated = units(previous?.Quantity || 0,'Previously allocated',true)+amount;
        if (!line || allocated > units(line.ReceivedQuantity || 0,'Received quantity',true)) fail('Allocation exceeds the supplier quantity received.',409);
        save('storekeepingAllocations',allocationKey,{ ...scope,PurchaseId,ItemId:item.ItemId,Quantity:quantity(allocated) },previous);
      }
      transfer = { ...scope, SlipId,Reference,Kind:action,ItemId:item.ItemId,ItemName:item.ItemName,Unit:item.Unit, Quantity:quantity(amount),
        Recipient,RecipientKey:scope.ScopeKey+'/'+Recipient,SenderKey:scope.ScopeKey+'/'+who,Destination,DestinationType,Origin:origin,SourceId,PurchaseId,AssetTag,Condition,Link,
        CreatedAt:now,CreatedByUsername:who,Fingerprint:fingerprint,Notes:field(body.Notes,'handover notes',1000),Status:'In transit' };
      if (action === 'return' && SourceId.startsWith('SK-')) transfer.OriginType = writes.find(w=>w.documentId===SourceId)?.data.DestinationType;
      save(slips,SlipId,transfer);
      movement = 'Dispatched';
    } else {
      item = await itemFor(existing.ItemId);
      const amount = units(existing.Quantity);
      transfer = { ...existing, ClosedAt:now,ClosedBy:who };
      if (action === 'accept') {
        if (who !== existing.Recipient
            || (existing.DestinationType === 'Store' && !keeper)) fail('Only the designated recipient with the required store access can accept.',403);
        if (existing.Kind === 'return') {
          if (existing.Condition === 'Available') changeStock(P.items,item.ItemId,item,amount);
          transfer.ReplacementRemaining = existing.Quantity;
          transfer.HeldQuantity = existing.Condition === 'Available' ? 0 : existing.Quantity;
        } else {
          transfer.HeldQuantity = existing.Quantity;
          if (existing.Link) await changeDepartment(existing.Link,amount);
        }
        movement = transfer.Status = 'Accepted';
      } else {
        if (existing.CreatedByUsername !== who && !keeper) fail('Only the sender or branch storekeeper can cancel.',403);
        if (existing.Kind === 'return' && existing.SourceId.startsWith('TRF-')) await adjustProcurementReturn(existing.SourceId,-amount);
        else if (existing.SourceId && existing.Kind !== 'replace') {
          await adjustSource(existing.SourceId,amount,'HeldQuantity');
          if (existing.Link) await changeDepartment(existing.Link,amount);
        } else {
          changeStock(P.items,item.ItemId,item,amount);
          if (existing.Kind === 'replace') await adjustSource(existing.SourceId,amount,'ReplacementRemaining');
          if (existing.PurchaseId) {
            const key = await digest([scope.ScopeKey,existing.PurchaseId,item.ItemId]);
            const row = await read('storekeepingAllocations',key);
            changeStock('storekeepingAllocations',key,row,-amount);
          }
        }
        movement = transfer.Status = 'Cancelled';
      }
      save(slips,SlipId,transfer,existing);
    }
    if (transfer.AssetTag) {
      const key = await digest([scope.ScopeKey,lower(transfer.AssetTag)]);
      const tag = await get(env,'storekeepingAssets',key);
      if (tag && (!sameScope(tag,scope) || tag.ItemId !== item.ItemId)) fail('This asset tag belongs to another item.',409);
      if (finalizing && tag?.SlipId !== SlipId) fail('Asset custody changed. Refresh this handover.',409);
      if (!finalizing && tag && (transfer.Kind === 'replace' || !transfer.SourceId ? tag.Holder !== 'Central' : tag.SlipId !== transfer.SourceId))
        fail('This asset is already assigned or in transit.',409);
      if (!finalizing && transfer.Kind === 'return' && transfer.SourceId.startsWith('SK-') && !tag)
        fail('Use the asset tag from the original handover.',409);
      const holder = !finalizing ? 'Transit' : action === 'cancel' ? tag.PreviousHolder
        : transfer.Kind === 'return' ? (transfer.Condition === 'Available' ? 'Central' : 'Quarantine') : transfer.Destination;
      save('storekeepingAssets',key,{ ...scope,ItemId:item.ItemId,AssetTag:transfer.AssetTag,Holder:holder,
        SlipId:action === 'cancel' ? tag.PreviousSlipId : SlipId,
        PreviousHolder:finalizing ? tag.PreviousHolder : tag?.Holder || (transfer.SourceId && transfer.Kind !== 'replace' ? transfer.Origin : 'Central'),
        PreviousSlipId:finalizing ? tag.PreviousSlipId : tag?.SlipId || (transfer.Kind === 'return' ? transfer.SourceId : '') },tag);
    }
    const eventId = now.replace(/[^0-9]/g,'')+'-'+SlipId+'-'+action;
    save(events,eventId,{ ...scope,ItemKey:scope.ScopeKey+'/'+item.ItemId,ItemName:item.ItemName,SlipId,Reference:transfer.Reference,
      Kind:transfer.Kind,Movement:movement,Origin:transfer.Origin,Destination:transfer.Destination,Quantity:transfer.Quantity,Unit:item.Unit,
      Condition:transfer.Condition,AssetTag:transfer.AssetTag,RecordedAt:now,RecordedBy:who });
    await commit(env,writes);
  }
  catch (error) {
    if (replay(await get(env,slips,SlipId).catch(() => null))) return { ...result,replayed:true };
    throw error;
  }
  return result;
}
