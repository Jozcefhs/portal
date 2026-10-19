(function (global) {
  'use strict';

  const DAYS = [['MON', 'Monday'], ['TUE', 'Tuesday'], ['WED', 'Wednesday'], ['THU', 'Thursday'], ['FRI', 'Friday'], ['SAT', 'Saturday'], ['SUN', 'Sunday']];
  const clean = (value) => String(value ?? '').trim();
  const escape = (value) => clean(value).replace(/[&<>"']/g, (letter) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[letter]));
  const enabled = (value) => value === true || ['YES', 'TRUE', '1', 'ON'].includes(clean(value).toUpperCase());
  const blankSlot = (working = false) => ({ Enabled: working, ResumptionTime: '08:00', ClosingTime: '17:00', EndDayOffset: 0 });
  const minutes = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(clean(value)) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : NaN;

  function groupFromFields(fields, slots) {
    const Name = clean(fields.Name);
    if (!Name || Name.length > 100) throw new Error('Enter a group name of 1–100 characters.');
    const ScheduleType = fields.ScheduleType === 'ROTATING' ? 'ROTATING' : 'FIXED';
    if (ScheduleType === 'FIXED' && slots.length !== 7) throw new Error('A fixed schedule must include all seven weekdays.');
    if (ScheduleType === 'ROTATING' && (slots.length < 1 || slots.length > 62)) throw new Error('A rotation must contain 1–62 calendar days.');
    const normalized = slots.map((slot, index) => {
      const row = { Enabled: enabled(slot.Enabled), ResumptionTime: clean(slot.ResumptionTime), ClosingTime: clean(slot.ClosingTime), EndDayOffset: Number(slot.EndDayOffset || 0) };
      if (!row.Enabled) return { ...row,
        ResumptionTime: Number.isFinite(minutes(row.ResumptionTime)) ? row.ResumptionTime : '08:00',
        ClosingTime: Number.isFinite(minutes(row.ClosingTime)) ? row.ClosingTime : '17:00',
        EndDayOffset: [0, 1, 2].includes(row.EndDayOffset) ? row.EndDayOffset : 0 };
      const duration = minutes(row.ClosingTime) + row.EndDayOffset * 1440 - minutes(row.ResumptionTime);
      if (![0, 1, 2].includes(row.EndDayOffset) || !Number.isFinite(duration) || duration <= 0 || duration > 2880) {
        throw new Error(`${ScheduleType === 'FIXED' ? DAYS[index][1] : `Day ${index + 1}`}: choose valid hours and an end day giving a shift longer than zero and no longer than 48 hours.`);
      }
      return row;
    });
    if (!normalized.some((row) => row.Enabled)) throw new Error('Enable at least one working day.');
    // Check across the repeat boundary too, including shifts lasting two days.
    const intervals = [];
    for (let day = 0; day < normalized.length * 3; day += 1) {
      const slot = normalized[day % normalized.length];
      if (slot.Enabled) intervals.push({ start: day * 1440 + minutes(slot.ResumptionTime), end: (day + slot.EndDayOffset) * 1440 + minutes(slot.ClosingTime) });
    }
    if (intervals.some((shift, index) => index && shift.start < intervals[index - 1].end)) throw new Error('Working shifts overlap. Mark the intervening days as rest days or adjust the end day.');
    const numeric = (name, maximum) => {
      const value = Number(fields[name]);
      if (!Number.isInteger(value) || value < 0 || value > maximum) throw new Error(`${name.replace(/([a-z])([A-Z])/g, '$1 $2')} must be a whole number between 0 and ${maximum}.`);
      return value;
    };
    const result = { GroupId: clean(fields.GroupId), Name, ScheduleType,
      GraceMinutes: numeric('GraceMinutes', 180), ClockInOpenMinutesBefore: numeric('ClockInOpenMinutesBefore', 360), OvertimeMinimumMinutes: numeric('OvertimeMinimumMinutes', 240) };
    if (ScheduleType === 'ROTATING') {
      const anchor = clean(fields.AnchorDate);
      const date = new Date(`${anchor}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== anchor) throw new Error('Choose a valid date for cycle day 1.');
      result.AnchorDate = anchor;
      result.CycleDays = normalized;
    } else result.DaySchedules = Object.fromEntries(DAYS.map(([key], index) => [key, normalized[index]]));
    return result;
  }

  function previewRows(group, fromDate, count = 14) {
    const first = new Date(`${clean(fromDate)}T00:00:00Z`);
    if (!Number.isFinite(first.getTime())) return [];
    const cycle = group.CycleDays || [];
    const anchor = Date.parse(`${group.AnchorDate}T00:00:00Z`);
    return Array.from({ length: count }, (_, index) => {
      const day = new Date(first.getTime() + index * 86400000);
      const date = day.toISOString().slice(0, 10);
      const cycleDay = cycle.length ? ((Math.round((day.getTime() - anchor) / 86400000) % cycle.length) + cycle.length) % cycle.length : 0;
      const slot = group.ScheduleType === 'ROTATING' ? cycle[cycleDay] : group.DaySchedules?.[DAYS[(day.getUTCDay() + 6) % 7][0]];
      return { date, cycleDay: cycleDay + 1, slot: slot || blankSlot() };
    });
  }

  function render(data) {
    if (!data.capabilities?.canManage) return '';
    return `<section class="config-group attendance-groups-workspace" id="staffAttendanceGroups">
      <header><strong>Attendance groups</strong><small>Give nurses, security teams and other staff their own fixed or rotating schedules. Unassigned staff keep the branch work hours. Location and identity rules remain shared.</small></header>
      <p class="status" data-group-status role="status" aria-live="polite"></p>
      <div class="attendance-group-toolbar"><button type="button" data-new-group>New attendance group</button><span>Time zone: ${escape(data.policy?.TimeZone || 'Africa/Lagos')}</span></div>
      <div class="attendance-group-list" data-group-list></div>
      <form class="attendance-group-editor" data-group-editor hidden autocomplete="off"></form>
      <div class="attendance-group-assignments">
        <h3>Assign staff to groups</h3><p class="muted">Assignments take effect today. Previous attendance records retain the schedule used for that shift. Use separate groups with different cycle day 1 dates for teams on staggered rotations.</p>
        <div class="attendance-group-filters"><label>Find staff <input type="search" data-staff-search placeholder="Name, username or role" autocomplete="off"></label><label>Department <select data-staff-department><option value="">All departments</option></select></label></div>
        <p data-assignment-count aria-live="polite"></p><div class="attendance-group-staff-list" data-assignment-list></div>
        <div class="attendance-group-actions"><span data-pending-count aria-live="polite">No unsaved assignments</span><button type="button" data-save-assignments disabled>Save assignments</button></div>
      </div>
    </section>`;
  }

  function mount(container, options) {
    if (!container || !options.data.capabilities?.canManage) return;
    const data = options.data;
    const roster = data.roster || { Revision: '', Groups: [], Assignments: [] };
    const groups = [...(roster.Groups || [])].sort((left, right) => clean(left.Name).localeCompare(clean(right.Name)));
    const staff = [...(data.staffDirectory || [])].sort((left, right) => clean(left.DisplayName || left.Username).localeCompare(clean(right.DisplayName || right.Username)));
    const today = clean(data.todayCalendarDate || data.todayAttendanceDate || data.attendanceDate) || new Date().toISOString().slice(0, 10);
    const currentAssignments = new Map();
    for (const row of roster.Assignments || []) {
      const key = clean(row.Username).toLowerCase();
      if (clean(row.EffectiveFrom) > today) continue;
      const previous = currentAssignments.get(key);
      if (!previous || clean(row.EffectiveFrom) >= clean(previous.EffectiveFrom)) currentAssignments.set(key, row);
    }
    const pending = new Map();
    const editor = container.querySelector('[data-group-editor]');
    const status = container.querySelector('[data-group-status]');
    let busy = false;
    let editing = false;
    let editDirty = false;
    let scheduleType = 'FIXED';
    let fixedDraft = [];
    let cycleDraft = [];
    const dirty = () => options.onDirty?.(editDirty || pending.size > 0);
    const notice = (message, bad = false) => { status.textContent = message; status.className = `status ${bad ? 'bad' : 'ok'}`; if (bad) void global.DynamaxStaffActionFeedback?.report(message, 'bad'); };
    const fields = () => Object.fromEntries(new FormData(editor));
    const readSlots = () => [...editor.querySelectorAll('[data-schedule-row]')].map((row) => ({
      Enabled: row.querySelector('[data-slot-enabled]').checked,
      ResumptionTime: row.querySelector('[data-slot-start]').value,
      ClosingTime: row.querySelector('[data-slot-end]').value,
      EndDayOffset: Number(row.querySelector('[data-slot-offset]').value)
    }));
    const slotHtml = (slot, index, rotating) => `<div class="attendance-group-schedule-row" data-schedule-row>
      <label class="attendance-group-working"><input type="checkbox" data-slot-enabled ${enabled(slot.Enabled) ? 'checked' : ''}><span>${rotating ? `Day ${index + 1}` : DAYS[index][1]} <small data-day-kind>${enabled(slot.Enabled) ? 'Work' : 'Rest'}</small></span></label>
      <label>Start <input type="time" data-slot-start value="${escape(slot.ResumptionTime || '08:00')}" ${enabled(slot.Enabled) ? 'required' : 'disabled'}></label>
      <label>End <input type="time" data-slot-end value="${escape(slot.ClosingTime || '17:00')}" ${enabled(slot.Enabled) ? 'required' : 'disabled'}></label>
      <label>End day <select data-slot-offset ${enabled(slot.Enabled) ? '' : 'disabled'}>${[[0, 'Same day'], [1, 'Next day'], [2, 'Two days later']].map(([value, label]) => `<option value="${value}"${Number(slot.EndDayOffset || 0) === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
    </div>`;
    const preview = () => {
      const target = editor.querySelector('[data-schedule-preview]');
      if (!target) return;
      try {
        const group = groupFromFields({ ...fields(), Name: fields().Name || 'Preview' }, readSlots());
        target.classList.remove('bad');
        target.innerHTML = `<strong>Next 14 days · ${escape(data.policy?.TimeZone || 'Africa/Lagos')}</strong><div class="attendance-group-preview-grid">${previewRows(group, today).map(({ date, cycleDay, slot }) => `<div><span>${escape(date)}${group.ScheduleType === 'ROTATING' ? ` · Day ${cycleDay}` : ''}</span><strong>${slot.Enabled ? `${escape(slot.ResumptionTime)}–${escape(slot.ClosingTime)}${slot.EndDayOffset ? ` (+${slot.EndDayOffset} day${slot.EndDayOffset > 1 ? 's' : ''})` : ''}` : 'Rest'}</strong></div>`).join('')}</div>`;
      } catch (error) { target.classList.add('bad'); target.textContent = error.message; }
    };
    const drawSlots = (slots, rotating) => {
      editor.querySelector('[data-schedule-slots]').innerHTML = slots.map((slot, index) => slotHtml(slot, index, rotating)).join('');
      preview();
    };
    const openEditor = async (group = {}) => {
      if (busy || (editDirty && !await options.confirm('Discard unsaved schedule changes?'))) return;
      const rotating = group.ScheduleType === 'ROTATING';
      const cycle = group.CycleDays?.length ? group.CycleDays : [blankSlot(true), blankSlot(), blankSlot()];
      const defaults = data.policy || {};
      scheduleType = rotating ? 'ROTATING' : 'FIXED';
      fixedDraft = DAYS.map(([day], index) => group.DaySchedules?.[day] || defaults.DaySchedules?.[day] || blankSlot(index < 5));
      cycleDraft = cycle;
      editor.hidden = false;
      editing = true;
      editDirty = false;
      dirty();
      editor.innerHTML = `<h3>${group.GroupId ? 'Edit attendance group' : 'New attendance group'}</h3>
        <input type="hidden" name="GroupId" value="${escape(group.GroupId)}">
        <div class="attendance-group-fields"><label>Group name <input name="Name" maxlength="100" value="${escape(group.Name)}" placeholder="e.g. Security team A" required></label>
        <label>Schedule type <select name="ScheduleType"><option value="FIXED"${rotating ? '' : ' selected'}>Fixed weekly schedule</option><option value="ROTATING"${rotating ? ' selected' : ''}>Repeating rotation</option></select></label>
        <label>Grace period (minutes) <input name="GraceMinutes" type="number" min="0" max="180" step="1" value="${Number(group.GraceMinutes ?? defaults.GraceMinutes ?? 15)}" required></label>
        <label>Clock-in opens before start (minutes) <input name="ClockInOpenMinutesBefore" type="number" min="0" max="360" step="1" value="${Number(group.ClockInOpenMinutesBefore ?? defaults.ClockInOpenMinutesBefore ?? 60)}" required></label>
        <label>Minimum overtime (minutes) <input name="OvertimeMinimumMinutes" type="number" min="0" max="240" step="1" value="${Number(group.OvertimeMinimumMinutes ?? defaults.OvertimeMinimumMinutes ?? 15)}" required></label></div>
        <div class="attendance-group-cycle" data-cycle-controls ${rotating ? '' : 'hidden'}><label>Cycle day 1 date <input name="AnchorDate" type="date" value="${escape(group.AnchorDate || today)}" ${rotating ? 'required' : 'disabled'}></label><label>Days in cycle <input name="CycleLength" type="number" min="1" max="62" step="1" value="${cycle.length}" ${rotating ? '' : 'disabled'}></label><button type="button" data-resize-cycle>Apply cycle length</button><button type="button" class="secondary" data-cycle-preset>24 hours on / 48 hours off</button></div>
        <p class="muted">Tick a day to start a shift; unticked days are rest days. Use “Next day” for an overnight or 24-hour shift. The entire schedule repeats, including rest days.</p>
        <div class="attendance-group-schedule" data-schedule-slots></div><div class="attendance-group-preview" data-schedule-preview aria-live="polite"></div>
        <p class="muted">Changes apply prospectively; already-started shifts keep their saved schedule.</p>
        <div class="attendance-group-actions"><button type="button" class="secondary" data-cancel-group>Cancel</button><button type="submit">Save attendance group</button></div>`;
      drawSlots(rotating ? cycleDraft : fixedDraft, rotating);
      editor.querySelector('[name="Name"]').focus();
    };
    const drawAssignments = () => {
      const query = clean(container.querySelector('[data-staff-search]').value).toLowerCase();
      const department = container.querySelector('[data-staff-department]').value;
      const filtered = staff.filter((person) => (!department || clean(person.Department) === department) && (!query || [person.Username, person.DisplayName, person.Role, person.Department].some((value) => clean(value).toLowerCase().includes(query))));
      container.querySelector('[data-assignment-count]').textContent = `${filtered.length} of ${staff.length} staff shown`;
      container.querySelector('[data-assignment-list]').innerHTML = filtered.map((person) => {
        const username = clean(person.Username);
        const assignment = currentAssignments.get(username.toLowerCase());
        const groupId = pending.has(username) ? pending.get(username) : clean(assignment?.GroupId);
        return `<label class="attendance-group-person"><span><strong>${escape(person.DisplayName || username)}</strong><small>@${escape(username)} · ${escape(person.Department || 'No department')} · ${escape(person.Role)}${assignment?.EffectiveFrom ? ` · Assigned ${escape(assignment.EffectiveFrom)}` : ''}</small></span><select data-staff-username="${escape(username)}" aria-label="Attendance group for ${escape(person.DisplayName || username)}"><option value="">Branch default</option>${groups.map((group) => `<option value="${escape(group.GroupId)}"${group.GroupId === groupId ? ' selected' : ''}>${escape(group.Name)}</option>`).join('')}</select></label>`;
      }).join('') || '<p class="muted">No staff match these filters.</p>';
      container.querySelector('[data-pending-count]').textContent = pending.size ? `${pending.size} unsaved assignment${pending.size === 1 ? '' : 's'}` : 'No unsaved assignments';
      container.querySelector('[data-save-assignments]').disabled = busy || !pending.size;
    };
    const mutate = async (action, body) => {
      if (busy) return;
      busy = true;
      const controls = [...container.querySelectorAll('button, input, select')].map((control) => [control, control.disabled]);
      controls.forEach(([control]) => { control.disabled = true; });
      notice('Saving…');
      try {
        const result = await options.request(action, { ...body, ExpectedRevision: roster.Revision });
        notice(result.message || 'Attendance groups saved.');
        await options.reload();
      } catch (error) {
        notice(error.message || 'Unable to save attendance groups. Refresh and try again.', true);
      } finally {
        busy = false;
        controls.forEach(([control, disabled]) => { if (control.isConnected) control.disabled = disabled; });
      }
    };
    container.querySelector('[data-group-list]').innerHTML = groups.map((group) => {
      const count = [...currentAssignments.values()].filter((row) => row.GroupId === group.GroupId).length;
      const referenced = (roster.Assignments || []).some((row) => row.GroupId === group.GroupId);
      return `<article class="attendance-group-card"><div><strong>${escape(group.Name)}</strong><small>${group.ScheduleType === 'ROTATING' ? `${group.CycleDays?.length || 0}-day rotation · Day 1: ${escape(group.AnchorDate)}` : 'Fixed weekly schedule'} · ${count} staff</small></div><div class="attendance-group-actions"><button type="button" class="secondary" data-edit-group="${escape(group.GroupId)}">Edit</button><button type="button" class="secondary danger" data-delete-group="${escape(group.GroupId)}"${referenced ? ' disabled title="Groups with current or historical assignments are retained to preserve attendance history"' : ''}>Delete</button></div></article>`;
    }).join('') || '<p class="muted">No attendance groups yet. All staff use the branch default.</p>';
    const departments = [...new Set(staff.map((person) => clean(person.Department)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    container.querySelector('[data-staff-department]').insertAdjacentHTML('beforeend', departments.map((department) => `<option value="${escape(department)}">${escape(department)}</option>`).join(''));
    drawAssignments();
    container.querySelector('[data-staff-search]').addEventListener('input', drawAssignments);
    container.querySelector('[data-staff-department]').addEventListener('change', drawAssignments);
    container.querySelector('[data-assignment-list]').addEventListener('change', (event) => {
      const select = event.target.closest('[data-staff-username]');
      if (!select || busy) return;
      const username = select.dataset.staffUsername;
      if (select.value === clean(currentAssignments.get(username.toLowerCase())?.GroupId)) pending.delete(username);
      else pending.set(username, select.value);
      dirty();
      container.querySelector('[data-pending-count]').textContent = `${pending.size} unsaved assignment${pending.size === 1 ? '' : 's'}`;
      container.querySelector('[data-save-assignments]').disabled = !pending.size;
    });
    container.addEventListener('click', async (event) => {
      const button = event.target.closest('button');
      if (!button || busy) return;
      if (button.matches('[data-new-group]')) await openEditor();
      else if (button.matches('[data-edit-group]')) await openEditor(groups.find((group) => group.GroupId === button.dataset.editGroup));
      else if (button.matches('[data-delete-group]')) {
        const group = groups.find((row) => row.GroupId === button.dataset.deleteGroup);
        if (await options.confirm(`Delete attendance group “${group.Name}”?${editDirty || pending.size ? ' Unsaved schedule and assignment changes will be discarded.' : ''}`)) await mutate('deletegroup', { GroupId: group.GroupId });
      } else if (button.matches('[data-cancel-group]')) {
        if (!editDirty || await options.confirm('Discard unsaved schedule changes?')) { editor.hidden = true; editing = false; editDirty = false; dirty(); }
      } else if (button.matches('[data-resize-cycle]')) {
        const count = Number(editor.elements.CycleLength.value);
        if (!Number.isInteger(count) || count < 1 || count > 62) { notice('Choose a cycle length from 1 to 62 days.', true); return; }
        const old = readSlots();
        if (count < old.length && !await options.confirm(`Remove the final ${old.length - count} day(s) from this cycle?`)) return;
        drawSlots(Array.from({ length: count }, (_, index) => old[index] || blankSlot()), true);
        editDirty = true; dirty();
      } else if (button.matches('[data-cycle-preset]')) {
        if (editDirty && !await options.confirm('Replace these schedule rows with 24 hours on / 48 hours off?')) return;
        editor.elements.CycleLength.value = '3';
        drawSlots([{ Enabled: true, ResumptionTime: '08:00', ClosingTime: '08:00', EndDayOffset: 1 }, blankSlot(), blankSlot()], true);
        editDirty = true; dirty();
      } else if (button.matches('[data-save-assignments]')) {
        if (editDirty && !await options.confirm('Save assignments and discard the unsaved schedule changes?')) return;
        await mutate('assigngroups', { Assignments: [...pending].map(([Username, GroupId]) => ({ Username, GroupId })) });
      }
    });
    editor.addEventListener('input', () => { if (!editing || busy) return; editDirty = true; dirty(); preview(); });
    editor.addEventListener('change', (event) => {
      if (busy) return;
      editDirty = true; dirty();
      if (event.target.name === 'ScheduleType') {
        if (scheduleType === 'ROTATING') cycleDraft = readSlots();
        else fixedDraft = readSlots();
        const rotating = event.target.value === 'ROTATING';
        scheduleType = event.target.value;
        const controls = editor.querySelector('[data-cycle-controls]');
        controls.hidden = !rotating;
        controls.querySelectorAll('input').forEach((input) => { input.disabled = !rotating; });
        editor.elements.AnchorDate.required = rotating;
        drawSlots(rotating ? cycleDraft : fixedDraft, rotating);
        editor.elements.CycleLength.value = String(cycleDraft.length);
      } else if (event.target.matches('[data-slot-enabled]')) {
        const row = event.target.closest('[data-schedule-row]');
        row.querySelectorAll('input[type="time"], select').forEach((input) => { input.disabled = !event.target.checked; });
        row.querySelector('[data-day-kind]').textContent = event.target.checked ? 'Work' : 'Rest';
      }
      preview();
    });
    editor.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      try {
        const group = groupFromFields(fields(), readSlots());
        if (group.ScheduleType === 'ROTATING' && Number(editor.elements.CycleLength.value) !== group.CycleDays.length) throw new Error('Apply the new cycle length before saving.');
        if (pending.size && !await options.confirm('Save this group and discard the unsaved staff assignments?')) return;
        await mutate('savegroup', { Group: group });
      } catch (error) { notice(error.message, true); }
    });
  }

  global.DynamaxAttendanceGroups = Object.freeze({ render, mount, groupFromFields, previewRows });
})(window);
