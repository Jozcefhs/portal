(() => {
  'use strict';
  const el = (tag, text = '') => {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  };
  function button(label, handler) {
    const node = el('button',label);
    node.type = 'button';
    node.onclick = handler;
    return node;
  }
  function triageContent(fields) {
    const {Complaint,NursingNotes,Urgency,AllergyStatus,Allergies,ObservedAt,...measurements} = fields;
    const Vitals = Object.fromEntries(Object.entries(measurements).filter(([,v])=>v !== ''));
    return {Complaint,NursingNotes,Urgency,AllergyStatus,Allergies,Vitals,ObservedAt};
  }
  function attach(host, scope, {api,run,writable,status}) {
    const panel = el('section');
    let sequence, cursor;
    const list = el('div');
    const more = button('Next signed entries',()=>run(()=>load(cursor)));
    const refresh = button('Refresh signed entries',()=>run(()=>load(null)));
    const editor = el('div');
    const open = button('Open care for '+scope.Reference,()=>run(async()=>{
      await load(null);
      open.hidden = true;
      panel.hidden = false;
    }));
    panel.hidden = true;
    async function load(after) {
      const data = await api('emergencyCareHistory',{...scope,...(after ? {Cursor:after} : {})});
      sequence = data.sequence;
      cursor = data.next;
      more.hidden = !cursor;
      list.innerHTML = data.entries.map(window.DynamaxHospitalClinical.entryMarkup).join('');
      if (!data.entries.length) list.textContent = 'No signed entries for this wristband.';
    }
    function addEditor(type) {
      const section = el('details');
      section.append(el('summary','Record '+type.toLowerCase()));
      let form;
      if (type === 'Triage') {
        form = document.getElementById('triageForm').cloneNode(true);
        form.removeAttribute('id');
        form.reset();
        for (const control of form.elements) control.disabled = false;
        form.querySelector('button').remove();
      } else {
        form = el('form');
        form.innerHTML = '<div class="form-grid"><label>Treatment given<textarea name="Treatment" required maxlength="8000"></textarea></label><label>Response or reassessment<textarea name="Response" maxlength="8000"></textarea></label><label>Given at (WAT)<input type="datetime-local" name="ObservedAt"></label></div>';
      }
      const sign = el('button','Review and sign '+type.toLowerCase());
      sign.type = 'submit';
      form.append(sign);
      form.onsubmit = event => {
        event.preventDefault();
        run(async()=>{
          const fields = Object.fromEntries([...form.elements].filter(e=>e.name).map(e=>[e.name,e.value]));
          fields.ObservedAt = fields.ObservedAt ? fields.ObservedAt+'+01:00' : '';
          const confirmed = await window.DynamaxDialogs.confirm({title:'Sign '+type.toLowerCase(),message:'Confirm the wristband on the patient reads '+scope.Reference+'. This entry will be retained under that reference.',confirmText:'Sign for '+scope.Reference});
          if (!confirmed || !form.isConnected) return;
          const saved = await api('signEmergencyCare',{...scope,Type:type,ConfirmedReference:scope.Reference,Sequence:sequence,
            Content:type === 'Triage' ? triageContent(fields) : fields},true);
          sequence = saved.Sequence;
          form.reset();
          section.open = false;
          more.hidden = true;
          list.textContent = type+' signed. Refresh signed entries to review the wristband history.';
          status(type+' signed for '+scope.Reference+'.');
        });
      };
      section.append(form);
      editor.append(section);
    }
    if (!scope.VisitId) {
      if (writable('triage.write')) addEditor('Triage');
      if (writable('consultations.write') || writable('nursing.write')) addEditor('Treatment');
    }
    panel.append(el('h4','Care for wristband '+scope.Reference),editor,list,more,refresh);
    host.append(open,panel);
  }
  window.DynamaxEmergencyCare = {attach};
})();
