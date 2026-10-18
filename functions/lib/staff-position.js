import { getDocument, queryCollectionPages } from './firestore.js';
import { findStaffUserRecord } from './staff-auth.js';
import { requiredDeploymentIdentity } from './deployment-identity.js';
import { staffRecordMatchesEdition } from './records-desk.js';
import { staffEmploymentDetails } from './staff-employment.js';
import { recordBranchId } from './branch-scope.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const slug = value => lower(value).replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 140);
const position = row => clean(row?.Position) || clean(row?.position);
const defaults = { staff: findStaffUserRecord, get: getDocument, query: queryCollectionPages };
const fail = message => Object.assign(new Error(message), { status: 409 });

// Position belongs to the employment record, not the permission role. Return
// only the authenticated officer's title; never expose their payroll details.
export async function loadStaffPosition(env, user, overrides = {}) {
  const io = { ...defaults, ...overrides };
  const { edition } = requiredDeploymentIdentity(env);
  const staff = await io.staff(env, user.username) || (
    lower(user.username) === lower(env.ADMIN_WEB_USERNAME || 'admin') && user.role === 'Super Admin'
      ? { Username: user.username, BranchId: user.branchId || 'main' } : null
  );
  if (!staff || !staffRecordMatchesEdition(staff, { edition, username: staff.Username || staff.username || staff.__id })) {
    throw fail('Your staff profile could not be verified. Refresh before preparing the letter.');
  }
  const identities = [...new Set([staff.Username, staff.username, staff.LoginUsername, staff.loginUsername,
    staff.__id, user.username].map(clean).filter(Boolean))];
  const aliases = new Set(identities.map(lower));
  const branch = recordBranchId(staff);
  const visible = row => row && aliases.has(lower(row.Username || row.username))
    && staffRecordMatchesEdition(row, { edition, username: row.Username || row.username })
    && recordBranchId(row, branch) === branch
    && !['no', 'false', '0', 'inactive', 'disabled'].includes(lower(row.Active ?? row.Status ?? 'active'));
  const pick = rows => {
    const titles = [...new Set(rows.filter(visible).map(position).filter(Boolean))];
    if (titles.length > 1) throw fail('Conflicting staff positions need HR review before this letter can be prepared.');
    return titles[0] || '';
  };
  // HR saves by a normalized username. Check trusted aliases without listing
  // either the staff directory or the complete employee/payroll collection.
  const hr = await Promise.all([...new Set(identities.map(slug))].map(id => io.get(env, 'hrEmployees', id)));
  const employment = staffEmploymentDetails(staff, hr, edition);
  let title = !['inactive', 'disabled', 'exited', 'terminated'].includes(lower(employment.Status)) ? clean(employment.Position) : '';
  if (!title) {
    const payroll = [];
    for (const username of [...new Set(identities.flatMap(value => [value, lower(value)]))]) {
      const rows = await io.query(env, 'payrollProfiles', { filters: [{ field: 'Username', op: '==', value: username }], pageSize: 50, maxRows: 200 });
      payroll.push(...rows);
    }
    title = pick(payroll) || position(staff);
  }
  return { Username: clean(user.username), Aliases: [...aliases], Edition: edition, BranchId: lower(user.branchId || branch),
    Position: title, IssuerTitle: title || 'Authorised Officer' };
}
