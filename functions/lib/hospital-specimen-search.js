import {clean,fail} from './hospital-model.js';
import {specimenLabel} from './hospital-orders-model.js';

const missing=()=>fail('No matching laboratory specimen in this branch.',404);

export async function findSpecimenReference({BranchId,reference,read,query,receivedSpecimen}){
  const value=clean(reference).toUpperCase();
  const label=/^(INV-[0-9A-F]{12})(?:-S([0-9]{2,10}))?$/.exec(value);
  const historical=/^LAB-H-([0-9A-F]{64})-([1-9][0-9]{0,9})$/.exec(value);
  let order,allocation,expectedLabel;
  if(label){
    const orders=await query('Orders',{BranchId,Kind:'Laboratory',OrderNumber:label[1]});
    if(orders.length>1)fail('More than one laboratory order has this label. Check the accession number before continuing.',409);
    order=orders[0];
    expectedLabel=value;
  }else if(historical){
    order=await read('Orders',historical[1].toLowerCase());
    if(order)expectedLabel=order.OrderNumber+'-S'+historical[2].padStart(2,'0');
  }else if(/^LAB-[0-9A-F]{12,64}-[0-9]{2,10}$/.test(value)){
    allocation=await read('SpecimenAccessions',value);
    if(allocation?.BranchId!==BranchId||allocation.AccessionNumber!==value)missing();
    order=await read('Orders',allocation.OrderId);
    expectedLabel=allocation.SpecimenLabel;
  }else{
    fail('Enter the complete accession number or specimen label.');
  }
  if(!order||order.BranchId!==BranchId||order.Kind!=='Laboratory')missing();
  if(allocation&&allocation.PatientId!==order.PatientId&&allocation.PatientId!==order.EmergencyArrivalId)missing();
  let specimen=order.CurrentSpecimen;
  if(specimen?.Label!==expectedLabel){
    if(label&&expectedLabel===specimenLabel(order)){
      specimen={Label:expectedLabel,Status:order.SpecimenWorkflow===2?'Awaiting collection':order.Status};
    }else{
      // Recollection can only follow rejection. Its signed event retains the old sample.
      const previous=/-S(\d+)$/.exec(expectedLabel);
      if(order.SpecimenWorkflow!==2||!previous||Number(previous[1])>=order.SpecimenSequence)missing();
      const events=await query('OrderEvents',{BranchId,OrderId:order.OrderId,Decision:'Rejected','Specimen.Label':expectedLabel});
      if(events.length!==1)missing();
      const event=events[0];
      if(event.PatientId!==order.PatientId&&event.PatientId!==order.EmergencyArrivalId)missing();
      specimen=event.Specimen;
    }
  }
  specimen=receivedSpecimen(order.OrderId,specimen);
  if(!label&&specimen.AccessionNumber?.toUpperCase()!==value)missing();
  return {order,specimen};
}
