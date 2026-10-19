(function installDynamaxListSorting(root) {
  const modes = Object.freeze([
    ['default', 'Default order'],
    ['name-asc', 'Name: A to Z'],
    ['name-desc', 'Name: Z to A'],
    ['created-desc', 'Created: newest first'],
    ['created-asc', 'Created: oldest first'],
    ['modified-desc', 'Modified: newest first'],
    ['modified-asc', 'Modified: oldest first']
  ]);

  const nameFields = Object.freeze([
    'Name', 'DisplayName', 'ApplicantName', 'StudentName', 'TeacherName', 'MemberName',
    'DonorName', 'CustomerName', 'ItemName', 'Title', 'Description', 'Code', 'Username'
  ]);
  const createdFields = Object.freeze([
    'CreatedAt', 'createdAt', '__createTime', 'SubmittedAt', 'RequestedAt', 'RecordedAt',
    'IssuedAt', 'PaidAt', 'Timestamp', 'Date'
  ]);
  const modifiedFields = Object.freeze([
    'UpdatedAt', 'updatedAt', '__updateTime', 'ModifiedAt', 'modifiedAt', 'LastUpdated',
    'ResultUpdatedAt', 'ApprovedAt', 'Timestamp', 'Date', 'CreatedAt', '__createTime'
  ]);

  function text(value) {
    return String(value ?? '').trim();
  }

  function firstValue(row = {}, fields = []) {
    for (const field of fields) {
      const value = row?.[field];
      if (value !== undefined && value !== null && text(value)) return text(value);
    }
    return '';
  }

  function nameValue(row = {}, columns = []) {
    const direct = firstValue(row, nameFields);
    if (direct) return direct;
    for (const column of columns) {
      if (!column?.value || /action|amount|total|status|date|time/i.test(text(column.label))) continue;
      try {
        const value = text(column.value(row));
        if (value) return value;
      } catch (_error) {
        // A display-only column must not prevent the remaining list from rendering.
      }
    }
    return '';
  }

  function timestamp(row = {}, fields = []) {
    const raw = firstValue(row, fields);
    if (!raw) return 0;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function compareText(left, right, direction = 1) {
    if (!left && !right) return 0;
    if (!left) return 1;
    if (!right) return -1;
    return text(left).localeCompare(text(right), undefined, { numeric: true, sensitivity: 'base' }) * direction;
  }

  function compareDates(left, right, direction = 1) {
    if (!left && !right) return 0;
    if (!left) return 1;
    if (!right) return -1;
    return (left - right) * direction;
  }

  function sortEntries(entries = [], mode = 'default') {
    const sorted = [...entries];
    sorted.sort((left, right) => {
      let result = 0;
      if (mode === 'name-asc') result = compareText(left.name, right.name, 1);
      if (mode === 'name-desc') result = compareText(left.name, right.name, -1);
      if (mode === 'created-asc') result = compareDates(left.created, right.created, 1);
      if (mode === 'created-desc') result = compareDates(left.created, right.created, -1);
      if (mode === 'modified-asc') result = compareDates(left.modified, right.modified, 1);
      if (mode === 'modified-desc') result = compareDates(left.modified, right.modified, -1);
      return result || left.index - right.index;
    });
    return sorted;
  }

  root.DynamaxListSorting = Object.freeze({
    modes, nameFields, createdFields, modifiedFields, firstValue, nameValue, timestamp, sortEntries
  });
})(globalThis);
