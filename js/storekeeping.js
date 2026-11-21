const esc = value => String(value ?? '').replace(/[&<>"']/g,ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[ch]);
const button = (key,label,disabled = false) => '<button type="button" data-action="'+key+'" '+(disabled?'disabled':'')+'>'+esc(label)+'</button>';
const input = (name,label,value='',extra='required maxlength="160"') => '<label>'+esc(label)+'<input name="'+name+'" value="'+esc(value)+'" '+extra+'></label>';
const options = values => values.map(v=>'<option>'+esc(v)+'</option>').join('');
export async function mountStorekeeping(root,{request,branch,procurement}) {
  const frame = document.createElement('section');
  frame.className = 'procurement-workspace';
  root.replaceChildren(frame);
  frame.innerHTML = '<header class="procurement-heading"><div><h2>Storekeeping</h2><p></p></div></header><div data-tabs class="procurement-actions storekeeping-navigation"></div><p role="status"></p><div data-body></div>';
  frame.querySelector('header p').textContent = branch;
  const body = frame.querySelector('[data-body]'), status = frame.querySelector('[role=status]');
  let access, view, rows=[],cursor='',item='',busy=false,section='';
  function form(kind,source={}) {
    const returning = kind==='return', replacing=kind==='replace';
    const central = !source.SlipId && !returning && !replacing;
    const transferId=source.SlipId || '';
    const stockOptions = view==='stock' && central
      ? '<label>Central item<select name="ItemId" required>'+rows.map(r=>'<option value="'+esc(r.ItemId)+'" '+(r.ItemId===source.ItemId?'selected':'')+'>'+esc(r.ItemName+' · '+r.Quantity+' '+r.Unit)+'</option>').join('')+'</select></label>'
      : input('ItemId','Procurement item ID',source.ItemId);
    body.innerHTML = '<h3>'+({issue:'Issue stock',return:'Return goods',replace:'Issue replacement'}[kind])+'</h3><form class="procurement-form">'+stockOptions+
      (central ? input('PurchaseId','Source purchase ID (optional)',source.PurchaseId || '','maxlength="160"') : input('SourceId',returning?'Original handover or Procurement transfer ID':'Original handover ID',transferId))+
      input('Quantity','Quantity','', 'type="number" step="0.001" min="0.001" required')+
      (returning ? '<label>Condition<select name="Condition">'+options(['Available','Needs repair','Damaged','Awaiting disposal'])+'</select></label>' :
      replacing ? '' : '<label>Send to<select name="DestinationType">'+options(['Department','Store'])+'</select></label>'+input('Destination','Department or store name'))+
      input('Recipient',returning?'Receiving storekeeper username':'Receiving staff username')+
      input('Reference','Unique handover slip reference')+input('AssetTag','Asset tag (optional)',replacing?'':source.AssetTag,'maxlength="100"')+
      '<label>Handover notes<textarea name="Notes" maxlength="1000" required></textarea></label><div><button type="submit">Record dispatch</button> '+button('back','Back')+'</div></form>';
    const f=body.querySelector('form');
    f.onsubmit=async e=>{
      e.preventDefault();
      await run(async()=>{
        const payload=Object.fromEntries(new FormData(f));
        if(returning || replacing) payload.Destination='Central store';
        const result=await request(kind,payload);
        await load('handovers',false,access.keeper?'handovers':'sent');
        status.textContent='Handover recorded. Reference '+result.SlipId+'. The recipient can now acknowledge delivery.';
      });
    };
    status.textContent='';
  }
  async function run(fn) {
    if(busy || !frame.isConnected) return;
    busy=true; frame.setAttribute('aria-busy','true');
    try { await fn(); } catch(error) { status.textContent=error.message; }
    finally { busy=false; frame.removeAttribute('aria-busy'); }
  }
  function table(headers,lines) {
    return '<div style="overflow:auto"><table><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+
      lines.map(cells=>'<tr>'+cells.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  }
  function render() {
    let headers,lines;
    if(view==='purchases') {
      headers=['Purchase','Item received','Received quantity','Action'];
      lines=rows.map((r,i)=>[esc(r.Reference),esc(r.ItemName),esc(r.Quantity+' '+r.Unit),button('issue:'+i,'Allocate received stock',access.readOnly)]);
    } else if(view==='stock') {
      headers=['Central item','Item ID','Available','Actions'];
      lines=rows.map((r,i)=>[esc(r.ItemName),esc(r.ItemId),esc(r.Quantity+' '+r.Unit),
        button('card:'+i,'Stock card')+' '+button('issue:'+i,'Issue',access.readOnly || !r.Quantity)]);
    } else if(view==='requests') {
      headers=['Approved requisition','Department','Requested items','Action'];
      lines=rows.map((r,i)=>[esc(r.RequisitionId),esc(r.Department),
        esc(r.Lines.map(l=>l.ItemName+' · '+l.Quantity+' '+l.Unit).join(', ')),button('dispatch:'+i,'Issue supplies',access.readOnly)]);
    } else if(view==='card') {
      headers=['Date','Slip','Movement','From','To','Quantity','Condition','Recorded by'];
      lines=rows.map(r=>[r.RecordedAt,r.Reference,r.Kind+' · '+r.Movement,r.Origin,r.Destination,r.Quantity+' '+r.Unit,r.Condition,r.RecordedBy].map(esc));
    } else {
      headers=['Slip','Item','From → To','Recipient','Quantity','Status','Action'];
      lines=rows.map((r,i)=>{
        const actions=[];
        if(!access.readOnly && r.Status==='In transit') {
          if(r.Recipient===access.username) actions.push(button('accept:'+i,'Accept delivery'));
          if(access.keeper || r.CreatedByUsername===access.username) actions.push(button('cancel:'+i,'Cancel dispatch'));
        }
        if(!access.readOnly && r.Status==='Accepted' && r.Kind!=='return' && r.HeldQuantity>0) {
          actions.push(button('return:'+i,'Return'));
          if(r.DestinationType==='Store') actions.push(button('issue:'+i,'Issue from store'));
        }
        if(!access.readOnly && access.keeper && r.ReplacementRemaining>0) actions.push(button('replace:'+i,'Replace'));
        return [esc(r.Reference)+'<small>'+esc(r.SlipId)+'</small>',esc(r.ItemName)+'<small>'+esc(r.AssetTag)+'</small>',esc(r.Origin+' → '+r.Destination),
          esc(r.Recipient),esc(r.Quantity+' '+r.Unit),esc(r.Status)+'<small>'+esc(r.Condition)+(r.HeldQuantity != null ? ' · Held '+esc(r.HeldQuantity):'')+'</small>',actions.join(' ')];
      });
    }
    body.innerHTML='<h3>'+esc(({purchases:'Supplier receipts',requests:'Approved department requests',stock:'Procurement stock available to issue',mine:'My handovers',sent:'Sent by me',handovers:'Branch handovers',card:'Storekeeping stock card'})[view])+'</h3>'+
      (rows.length?table(headers,lines):'<p>No matching records.</p>')+(cursor?button('more','Load more'):'')+
      (view==='card' && rows.length?button('print','Print stock card',!!cursor):'');
  }
  async function load(kind,more=false,override='') {
    const key=override || kind;
    const result=await request(key,{ ...(more?{Cursor:cursor}:{}),...(key==='card'?{ItemId:item}:{}),...(key==='requests'?{SchoolSection:section}:{}) });
    view=key; rows=more?rows.concat(result.rows):result.rows;cursor=result.cursor;
    render();status.textContent='';
  }
  function printCard() {
    const win=window.open('','_blank');
    if(!win) throw new Error('Allow the print window to open.');
    win.opener=null;
    win.document.title='Storekeeping stock card';
    const heading=win.document.createElement('h2');
    heading.textContent='Storekeeping stock card · '+branch+' · '+(rows[0]?.ItemName || item);
    win.document.body.append(heading,win.document.importNode(body.querySelector('table'),true));
    win.document.close();win.print();
  }
  function activate(key) {
    return run(async()=>{
      const [action,index]=key.split(':'),row=rows[Number(index)];
      if(action==='procurement') return procurement();
      if(action==='back') return render();
      if(action==='more') return load(view,true);
      if(action==='print') return printCard();
      if(action==='dispatch') {
        const ref=crypto.randomUUID();
        body.innerHTML='<h3>Issue to '+esc(row.Department)+'</h3><form class="procurement-form">'+row.Lines.map((l,i)=>{
          const remaining=Math.round((l.Quantity-(l.IssuedQuantity || 0))*1000)/1000;
          return input('qty'+i,l.ItemName+' ('+remaining+' '+l.Unit+' remaining)',0,'type="number" min="0" max="'+esc(remaining)+'" step="0.001"');
        }).join('')+input('Notes','Dispatch notes')+'<button type="submit">Dispatch selected quantities</button>'+button('back','Back')+'</form>';
        body.querySelector('form').onsubmit=e=>{
          e.preventDefault();
          run(async()=>{
            const values=new FormData(e.target);
            const Lines=row.Lines.map((l,i)=>({ ItemId:l.ItemId,Quantity:Number(values.get('qty'+i)) })).filter(l=>l.Quantity>0);
            if(!Lines.length) throw new Error('Enter an issue quantity.');
            const result=await request('issueRequest',{RequisitionId:row.RequisitionId,ExpectedRevision:row.Revision,RequestId:ref,Notes:values.get('Notes'),Lines});
            await load('requests');status.textContent='Dispatched for department confirmation in Procurement. '+result.TransferId;
          });
        };
        return;
      }
      if(['mine','sent','handovers','stock','requests','purchases'].includes(action)) return load(action);
      if(action==='card') {item=row.ItemId;return load('card');}
      if(['issue','return','replace'].includes(action)) return form(action,row);
      if(['accept','cancel'].includes(action)) {
        if(!window.confirm((action==='accept'?'Confirm physical receipt of ':'Cancel the dispatch of ')+row.Quantity+' '+row.Unit+' of '+row.ItemName+'?')) return;
        await request(action,{SlipId:row.SlipId}); await load(view);status.textContent=action==='accept'?'Receipt recorded.':'Dispatch cancelled.';
      }
    });
  }
  frame.onclick=e=>{
    const key=e.target.closest('[data-action]')?.dataset.action;
    if(key) activate(key);
  };
  try {
    access=await request('access',{});
    section=access.sections[0];
    const actions=[];
    if(access.keeper) actions.push(['stock','Central stock'],['purchases','Supplier receipts'],['handovers','Branch handovers'],['requests','Approved requests']);
    actions.push(['mine','My handovers'],['sent','Sent by me']);
    if(access.keeper && !access.readOnly) actions.push(['return','Return a Procurement delivery']);
    if(procurement) actions.push(['procurement','Procurement']);
    const sectionFilter=access.keeper && access.sections.length>1
      ? '<label>Request section<select data-section>'+options(access.sections)+'</select></label>' : '';
    frame.querySelector('[data-tabs]').innerHTML='<label>Storekeeping action<select data-store-action><option value="">Choose an action</option>'+
      actions.map(([key,label])=>'<option value="'+key+'">'+esc(label)+'</option>').join('')+'</select></label>'+sectionFilter;
    const actionPicker=frame.querySelector('[data-store-action]');
    actionPicker.onchange=async()=>{
      const key=actionPicker.value;
      actionPicker.value='';
      if(key) await activate(key);
    };
    const picker=frame.querySelector('[data-section]');
    if(picker) picker.onchange=()=>run(async()=>{ section=picker.value;if(view==='requests') await load('requests'); });
    status.textContent=access.keeper?'Use Approved requests for department inventory. Use Central stock or Supplier receipts to hand goods to a storekeeper or a department for internal use.':'Open My handovers to acknowledge deliveries and return items.';
  } catch(error) {status.textContent=error.message;}
}
