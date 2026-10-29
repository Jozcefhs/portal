import {digest,fail} from './hospital-model.js';
import {medicine,quantity,field,dateOnly,money,watDay,qty} from './hospital-orders-model.js';

export async function stockReceiptFields(input,BranchId,clock){
  const details=await medicine(input),Quantity=quantity(input?.Quantity);
  const BatchNumber=field(input,'BatchNumber',120,true),ExpiryDate=dateOnly(input?.ExpiryDate),Supplier=field(input,'Supplier',160,true),
    ReceiptReference=field(input,'ReceiptReference',160,true),LineReference=field(input,'LineReference',60,true),UnitPriceCents=money(input?.UnitPrice);
  if(ExpiryDate<=watDay(clock()))fail('Receive only stock with a future expiry date into usable inventory.');
  return {details,Quantity,BatchNumber,ExpiryDate,Supplier,ReceiptReference,LineReference,UnitPriceCents,
    BatchId:await digest(JSON.stringify([BranchId,details.MedicineKey,BatchNumber,ExpiryDate])),
    ReceiptId:await digest(JSON.stringify([BranchId,Supplier.toLowerCase(),ReceiptReference.toLowerCase(),LineReference.toLowerCase()]))};
}

// Both direct stock intake and approved purchase deliveries use the same receipt guard.
export async function prepareStockReceipt({read,write,strip,clock,stamp},fields,BranchId,key,extra={}){
  const {details,Quantity,BatchNumber,ExpiryDate,Supplier,ReceiptReference,LineReference,UnitPriceCents,BatchId,ReceiptId}=fields;
  if(await read('StockReceipts',ReceiptId))fail('This supplier receipt line has already been recorded.',409);
  const old=await read('MedicineBatches',BatchId);
  if(old&&old.UnitPriceCents!==UnitPriceCents)fail('This batch has a different selling price. Use the existing batch price to receive additional stock.',409);
  const batch={...strip(old),...details,BatchId,BranchId,BatchNumber,ExpiryDate,UnitPriceCents,OnHand:qty((old?.OnHand||0)+Quantity),
    Quarantined:old?.Quarantined||0,CreatedAt:old?.CreatedAt||clock(),UpdatedAt:clock()};
  return {BatchId,ReceiptId,writes:[write('MedicineBatches',BatchId,batch,old),
    write('StockReceipts',ReceiptId,{ReceiptId,BatchId,BranchId,Quantity,Supplier,ReceiptReference,LineReference,...extra,...stamp()},null),
    write('StockMovements',key,{MovementId:key,BatchId,BranchId,Type:'Receipt',Quantity,ReceiptId,Supplier,ReceiptReference,LineReference,...extra,...stamp()},null)]};
}
