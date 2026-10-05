(function (root) {
  'use strict';
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

  async function open({ staffFetch, branchId, schoolSection }) {
    if (!branchId || branchId === 'all') throw new Error('Choose one working branch first.');
    const dialog = document.createElement('dialog');
    dialog.className = 'teacher-homework-dialog';
    dialog.setAttribute('aria-label', 'Homework / parent message');
    dialog.innerHTML = `<form method="dialog" class="teacher-homework-heading"><div><p class="eyebrow">Teacher → parents</p><h2>Homework / parent message</h2></div><button aria-label="Close homework" class="secondary">Close</button></form><p data-homework-status role="status">Loading your active subject assignments…</p><div data-homework-body></div>`;
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.showModal();
    const status = dialog.querySelector('[data-homework-status]');
    const request = async (action, input = {}) => {
      const response = await staffFetch('/api/staff-homework', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, BranchId: branchId, SchoolSection: schoolSection, ...input })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw Object.assign(new Error(data.message || 'Homework could not be processed.'), { status: response.status });
      return data;
    };
    try {
      const data = await request('getContext');
      if (!dialog.isConnected) return;
      if (!data.targets.length) {
        status.textContent = 'No active subject-teacher assignment was found in this school section. Ask Academic Management to assign your subject, class and arms for the active session and term.';
        return;
      }
      dialog.querySelector('[data-homework-body]').innerHTML = `<form data-homework-compose>
        <label>My class and subject<select name="Target" required>${data.targets.map((target, index) => `<option value="${index}">${escape(`${target.ClassName} · ${target.SubjectName} — ${target.SessionName}, ${target.TermName}`)}</option>`).join('')}</select></label>
        <fieldset><legend>Assigned arms — select recipients</legend><div data-homework-arms></div></fieldset>
        <label>Title<input name="Title" required maxlength="160" placeholder="e.g. Mathematics homework for Tuesday"></label>
        <label>Homework instructions<textarea name="Message" required maxlength="2000" rows="6" placeholder="Explain the task, materials and submission instructions."></textarea></label>
        <label>Due date (optional)<input name="DueDate" type="date"></label>
        <p class="muted">Only active students taking this subject in the selected arms are included. Messages appear in the parent portal when in-app delivery is enabled; browser/phone push requires notification permission and enabled preferences.</p>
        <button type="submit" data-homework-preview>Preview audience & message</button>
        <section data-homework-confirm hidden><h3>Preview</h3><p data-homework-audience></p><p data-homework-missing></p><h4 data-homework-title></h4><p data-homework-message class="teacher-homework-message"></p><p data-homework-due></p><button type="button" data-homework-send>Send to selected parents</button></section>
      </form>`;
      const form = dialog.querySelector('[data-homework-compose]');
      const confirm = form.querySelector('[data-homework-confirm]');
      const send = form.querySelector('[data-homework-send]');
      let preview = null;
      let requestId = root.crypto.randomUUID();
      let busy = false;
      let uncertain = false;
      let draftVersion = 0;
      const renderArms = () => {
        const target = data.targets[Number(form.elements.Target.value)];
        form.querySelector('[data-homework-arms]').innerHTML = target.Arms.map((arm) => `<label class="teacher-homework-arm"><input type="checkbox" name="ArmIds" value="${escape(arm.ArmId)}"> ${escape(arm.Name)}</label>`).join('');
      };
      const invalidate = () => {
        preview = null; confirm.hidden = true; draftVersion += 1;
        requestId = root.crypto.randomUUID();
        status.textContent = 'Preview the selected audience before sending.';
      };
      const payload = () => {
        const target = data.targets[Number(form.elements.Target.value)];
        return { SessionId: target.SessionId, TermId: target.TermId, ClassId: target.ClassId, SubjectId: target.SubjectId,
          ArmIds: [...form.querySelectorAll('[name="ArmIds"]:checked')].map((input) => input.value),
          Title: form.elements.Title.value, Message: form.elements.Message.value, DueDate: form.elements.DueDate.value };
      };
      const lock = (disabled) => form.querySelectorAll('input, textarea, select, button').forEach((control) => { control.disabled = disabled; });
      form.addEventListener('input', invalidate);
      form.elements.Target.addEventListener('change', () => { renderArms(); invalidate(); });
      renderArms();
      status.textContent = 'Choose the assigned arms and write your message.';
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (busy || uncertain) return;
        const input = payload();
        if (!input.ArmIds.length) { status.textContent = 'Select at least one assigned arm.'; return; }
        const version = draftVersion;
        busy = true; lock(true); status.textContent = 'Checking the current audience…';
        try {
          const result = await request('previewHomework', input);
          if (!dialog.isConnected || version !== draftVersion) return;
          preview = { ...input, PreviewDigest: result.PreviewDigest, RequestId: requestId };
          const summary = result.summary;
          form.querySelector('[data-homework-audience]').textContent = `${summary.ClassName} · ${summary.SubjectName} · Arms: ${summary.Arms.join(', ')}. ${summary.Students} students; ${summary.ParentAccounts} linked parent accounts (duplicate parents receive one message).`;
          form.querySelector('[data-homework-missing]').textContent = summary.MissingParentEmail ? `${summary.MissingParentEmail} student(s) have no valid parent email. Their linked parent may see the message in-app, but cannot receive push until their profile is corrected.` : '';
          form.querySelector('[data-homework-title]').textContent = result.preview.Title;
          form.querySelector('[data-homework-message]').textContent = result.preview.Message;
          form.querySelector('[data-homework-due]').textContent = result.preview.DueDate ? `Due: ${result.preview.DueDate}` : '';
          confirm.hidden = false;
          status.textContent = 'Review the audience and message, then confirm sending.';
          confirm.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } catch (error) { status.textContent = error.message; }
        finally { busy = false; if (dialog.isConnected) lock(false); }
      });
      send.addEventListener('click', async () => {
        if (!preview || busy) return;
        busy = true; lock(true); status.textContent = 'Saving homework and queueing push delivery…';
        try {
          const result = await request('sendHomework', preview);
          if (!dialog.isConnected) return;
          status.textContent = result.message;
          confirm.hidden = true;
          preview = null;
          uncertain = false;
          // Keep this completed composer locked; reopen to compose a new message.
        } catch (error) {
          if (!dialog.isConnected) return;
          status.textContent = error.message;
          if (error.status && error.status < 500) {
            uncertain = false; lock(false); preview = null; confirm.hidden = true;
          } else {
            // A timeout can happen after commit. Retry the SAME immutable request.
            uncertain = true; send.disabled = false; send.textContent = 'Retry / check this same send';
            status.textContent += ' Delivery status is uncertain. Retry this same send to avoid duplicates.';
          }
        } finally { busy = false; }
      });
    } catch (error) { if (dialog.isConnected) status.textContent = error.message; }
  }
  root.DynamaxTeacherHomework = { open };
})(window);
