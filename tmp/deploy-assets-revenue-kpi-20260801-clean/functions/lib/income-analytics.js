function clean(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function amount(value) {
  const parsed = Number(String(value ?? 0).replace(/[₦,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateOnly(value) {
  const match = clean(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function parseDate(value) {
  const normalized = dateOnly(value);
  return normalized ? new Date(`${normalized}T00:00:00Z`) : null;
}

function isoDate(value) {
  return value.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonths(value, months) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1));
}

function monthEnd(value) {
  return addDays(addMonths(new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1)), 1), -1);
}

function daysBetween(from, to) {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86400000));
}

function journalLines(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }
  return [];
}

export function resolveIncomePeriod(filter = {}, today = new Date()) {
  const safeToday = parseDate(today instanceof Date ? isoDate(today) : today) || new Date();
  const mode = ['daily', 'weekly', 'monthly', 'quarterly', 'custom'].includes(lower(filter.period))
    ? lower(filter.period)
    : 'monthly';
  const anchor = parseDate(filter.anchorDate) || safeToday;
  let from;
  let to;
  if (mode === 'custom') {
    from = parseDate(filter.dateFrom) || new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    to = parseDate(filter.dateTo) || anchor;
  } else if (mode === 'daily') {
    from = anchor;
    to = anchor;
  } else if (mode === 'weekly') {
    from = addDays(anchor, -6);
    to = anchor;
  } else if (mode === 'quarterly') {
    const quarterMonth = Math.floor(anchor.getUTCMonth() / 3) * 3;
    from = new Date(Date.UTC(anchor.getUTCFullYear(), quarterMonth, 1));
    to = monthEnd(new Date(Date.UTC(anchor.getUTCFullYear(), quarterMonth + 2, 1)));
  } else {
    from = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    to = monthEnd(anchor);
  }
  if (from > to) [from, to] = [to, from];
  const span = daysBetween(from, to) + 1;
  let previousTo = addDays(from, -1);
  let previousFrom = addDays(previousTo, -(span - 1));
  if (mode === 'monthly') {
    previousFrom = addMonths(from, -1);
    previousTo = monthEnd(previousFrom);
  } else if (mode === 'quarterly') {
    previousFrom = addMonths(from, -3);
    previousTo = addDays(from, -1);
  }
  return {
    mode,
    dateFrom: isoDate(from),
    dateTo: isoDate(to),
    previousDateFrom: isoDate(previousFrom),
    previousDateTo: isoDate(previousTo),
    bucket: mode === 'quarterly' || span > 45 ? 'month' : 'day'
  };
}

function sourceLabel(journal, account = {}) {
  const givingType = clean(journal.GivingTypeName || journal.givingTypeName);
  if (givingType) return givingType;
  const text = lower(`${journal.Source} ${journal.Description}`);
  const accountLabel = clean(account.name).replace(/\s+(?:income|revenue)$/i, '').trim();
  if (text.includes('donation') || text.includes('offering')) {
    return accountLabel || (text.includes('offering') ? 'Offerings' : 'Donations');
  }
  if (text.includes('admission form') || text.includes('form sale')) return 'Admission Forms';
  if (text.includes('wallet purchase') || text.includes('tuck')) return 'Wallet Purchases';
  if (text.includes('restaurant') || text.includes('catering')) return 'Restaurant';
  if (text.includes('store') || text.includes('book') || text.includes('uniform')) return 'Store Sales';
  if (text.includes('program')) return 'Programmes';
  if (text.includes('fee') || text.includes('invoice') || text.includes('tuition')) return 'Fees';
  return accountLabel || clean(journal.Source) || 'Other Income';
}

function paymentChannel(journal) {
  const text = lower(`${journal.PaymentMethod} ${journal.Method} ${journal.Gateway}`);
  if (text.includes('mobile money')) return 'Mobile Money';
  if (text.includes('bank transfer') || text.includes('transfer')) return 'Bank Transfer';
  if (text.includes('cheque') || text.includes('check')) return 'Cheque';
  if (text.includes('pos')) return 'POS';
  if (text.includes('online') || text.includes('paystack') || text.includes('gateway')) return 'Online';
  if (text.includes('card')) return 'Card';
  if (text.includes('cash')) return 'Cash';
  if (text.includes('wallet')) return 'Wallet';
  const debitCodes = new Set(journalLines(journal.Lines).filter((line) => amount(line.Debit) > 0).map((line) => clean(line.AccountCode)));
  if (debitCodes.has('1030')) return 'Online';
  if (debitCodes.has('1010')) return 'Cash';
  if (debitCodes.has('1020')) return 'Bank Transfer';
  if (debitCodes.has('2200')) return 'Wallet';
  if (debitCodes.has('1100')) return 'Receivable';
  return 'Other';
}

function journalDepartments(journal) {
  return [...new Set([
    clean(journal.Department),
    ...journalLines(journal.Lines).map((line) => clean(line.Department))
  ].filter(Boolean))];
}

function journalBranches(journal) {
  const explicit = [
    clean(journal.BranchId),
    ...journalLines(journal.Lines).map((line) => clean(line.BranchId))
  ].filter(Boolean);
  if (explicit.length) return [...new Set(explicit)];
  const source = lower(`${journal.Source} ${journal.Description}`);
  if (!source.includes('donation') && !source.includes('offering')) return [];
  return [...new Set(journalLines(journal.Lines).map((line) => clean(line.CostCentre)).filter(Boolean))];
}

function periodContains(date, from, to) {
  return Boolean(date && date >= from && date <= to);
}

function displayBucketLabel(key, bucket) {
  const parsed = parseDate(key);
  if (!parsed) return key;
  return bucket === 'month'
    ? new Intl.DateTimeFormat('en', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(parsed)
    : new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(parsed);
}

function timelineBuckets(period, records) {
  const from = parseDate(period.dateFrom);
  const to = parseDate(period.dateTo);
  const totals = new Map();
  records.forEach((row) => {
    const parsed = parseDate(row.date);
    if (!parsed) return;
    const key = period.bucket === 'month'
      ? `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-01`
      : isoDate(parsed);
    totals.set(key, amount(totals.get(key)) + amount(row.amount));
  });
  const rows = [];
  if (period.bucket === 'month') {
    for (let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)); cursor <= to; cursor = addMonths(cursor, 1)) {
      const key = isoDate(cursor);
      rows.push({ key, label: displayBucketLabel(key, 'month'), value: amount(totals.get(key)) });
    }
  } else {
    for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) {
      const key = isoDate(cursor);
      rows.push({ key, label: displayBucketLabel(key, 'day'), value: amount(totals.get(key)) });
    }
  }
  return rows;
}

function groupedRows(records, key) {
  const totals = new Map();
  records.forEach((row) => totals.set(row[key], amount(totals.get(row[key])) + amount(row.amount)));
  return Array.from(totals, ([label, value]) => ({ label, value: amount(value) }))
    .filter((row) => Math.abs(row.value) > 0.005)
    .sort((a, b) => b.value - a.value);
}

function uniqueSorted(values) {
  return [...new Set(values.map(clean).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function buildIncomeAnalytics(chart = [], journals = [], filter = {}, today = new Date()) {
  const period = resolveIncomePeriod(filter, today);
  const accounts = new Map((chart || []).map((row) => [
    clean(row.Code || row.code || row.__id),
    { code: clean(row.Code || row.code || row.__id), name: clean(row.Name || row.name), type: lower(row.Type || row.type) }
  ]));
  const posted = (journals || []).filter((journal) => lower(journal.Status || journal.status) === 'posted');
  const allRecords = posted.flatMap((journal) => {
    const date = dateOnly(journal.Date || journal.date || journal.CreatedAt);
    const channel = paymentChannel(journal);
    const departments = journalDepartments(journal);
    const branches = journalBranches(journal);
    const revenueLines = journalLines(journal.Lines || journal.lines).filter((line) => {
      const account = accounts.get(clean(line.AccountCode || line.accountCode));
      return account?.type === 'revenue';
    });
    return revenueLines.map((line) => {
      const account = accounts.get(clean(line.AccountCode || line.accountCode));
      const source = sourceLabel(journal, account);
      return {
        journalNo: clean(journal.JournalNo || journal.__id),
        date,
        reference: clean(journal.Reference || journal.SourceId),
        description: clean(journal.Description || line.Description) || source,
        source,
        channel,
        department: clean(line.Department || journal.Department) || 'Unassigned',
        departments,
        branches,
        accountCode: account.code,
        accountName: account.name || account.code,
        amount: amount(line.Credit) - amount(line.Debit)
      };
    });
  }).filter((row) => row.date && Math.abs(row.amount) > 0.005);

  const accountFilter = clean(filter.accountCode);
  const departmentFilter = lower(filter.department);
  const channelFilter = lower(filter.channel);
  const sourceFilter = lower(filter.source);
  const matchesDimensions = (row) =>
    (!accountFilter || row.accountCode === accountFilter) &&
    (!departmentFilter || lower(row.department) === departmentFilter || row.departments.some((item) => lower(item) === departmentFilter)) &&
    (!channelFilter || lower(row.channel) === channelFilter) &&
    (!sourceFilter || lower(row.source) === sourceFilter);
  const dimensionRows = allRecords.filter(matchesDimensions);
  const currentRows = dimensionRows.filter((row) => periodContains(row.date, period.dateFrom, period.dateTo));
  const previousRows = dimensionRows.filter((row) => periodContains(row.date, period.previousDateFrom, period.previousDateTo));
  const total = currentRows.reduce((sum, row) => sum + row.amount, 0);
  const previousTotal = previousRows.reduce((sum, row) => sum + row.amount, 0);
  const transactionCount = new Set(currentRows.map((row) => row.journalNo)).size;
  const comparisonPercent = Math.abs(previousTotal) > 0.005
    ? ((total - previousTotal) / Math.abs(previousTotal)) * 100
    : (Math.abs(total) > 0.005 ? 100 : 0);
  const transactions = Array.from(currentRows.reduce((map, row) => {
    const existing = map.get(row.journalNo) || { ...row, amount: 0, accounts: [], departments: [] };
    existing.amount += row.amount;
    existing.accounts.push(`${row.accountCode} - ${row.accountName}`);
    existing.departments.push(row.department);
    map.set(row.journalNo, existing);
    return map;
  }, new Map()).values()).map((row) => ({
    ...row,
    amount: amount(row.amount),
    accounts: uniqueSorted(row.accounts).join(', '),
    department: uniqueSorted(row.departments).join(', ') || 'Unassigned'
  })).sort((a, b) => `${b.date}|${b.journalNo}`.localeCompare(`${a.date}|${a.journalNo}`));

  return {
    period,
    summary: {
      totalIncome: amount(total),
      transactionCount,
      averageIncome: transactionCount ? amount(total / transactionCount) : 0,
      previousTotal: amount(previousTotal),
      comparisonPercent: Number(comparisonPercent.toFixed(1))
    },
    timeline: timelineBuckets(period, currentRows),
    sources: groupedRows(currentRows, 'source'),
    channels: groupedRows(currentRows, 'channel'),
    transactions,
    options: {
      accounts: uniqueSorted(allRecords.map((row) => `${row.accountCode}|${row.accountName}`)).map((item) => {
        const [code, ...name] = item.split('|');
        return { code, name: name.join('|') };
      }),
      departments: uniqueSorted(allRecords.map((row) => row.department)),
      channels: uniqueSorted(allRecords.map((row) => row.channel)),
      sources: uniqueSorted(allRecords.map((row) => row.source)),
      branches: uniqueSorted(allRecords.flatMap((row) => row.branches))
    }
  };
}

export function journalMatchesIncomeBranch(journal, branchId) {
  const wanted = lower(branchId);
  if (!wanted || wanted === 'all') return true;
  const branches = journalBranches(journal).map(lower);
  if (!branches.length) return wanted === 'main';
  return branches.includes(wanted);
}
