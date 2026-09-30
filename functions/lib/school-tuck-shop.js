import { listCollection } from './firestore.js';
import { listSchoolCollection, schoolSectionFor } from './school-scope.js';
import { borrowerFrom, searchLibraryBorrowers } from './school-library.js';
import { recordManualOrganizationCommerceSale } from './organization-commerce.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

function failure(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function branchId(user = {}) {
  return lower(user.branchId || user.BranchId || 'main') || 'main';
}

async function scopedStaff(env, user = {}) {
  const branch = branchId(user);
  return (await listCollection(env, 'staffUsers')).filter((row) => {
    const edition = lower(row.OrganisationEdition || row.OrganizationEdition || row.Edition);
    return (!clean(row.BranchId) || lower(row.BranchId) === branch)
      && (!edition || edition === 'school');
  });
}

async function scopedStudents(env, user = {}) {
  const branch = branchId(user);
  const section = lower(user.schoolSectionAccess || user.SchoolSectionAccess);
  return (await listSchoolCollection(env, 'students', { branchId: branch }))
    .filter((row) => lower(row.BranchId || 'main') === branch
      && (!['primary', 'secondary'].includes(section) || schoolSectionFor(row) === section));
}

export async function searchTuckShopCustomers(env, user = {}, body = {}) {
  const type = clean(body.CustomerType || body.BorrowerType || 'Student');
  if (!['Student', 'Staff'].includes(type)) throw failure('Choose Student or Staff as the customer type.');
  const query = clean(body.Query);
  if (query.length < 2) return { ok: true, customers: [] };
  const rows = type === 'Student' ? await scopedStudents(env, user) : await scopedStaff(env, user);
  const customers = searchLibraryBorrowers(query, type,
    type === 'Student' ? rows : [], type === 'Staff' ? rows : [])
    .map(({ BorrowerRef, BorrowerName, ClassName }) => ({
      CustomerType: type, CustomerRef: BorrowerRef, CustomerName: BorrowerName, Detail: ClassName
    }));
  return { ok: true, customers };
}

export async function getTuckShopCatalog(env, user = {}) {
  const branch = branchId(user);
  const inventory = (await listCollection(env, 'tuckShopInventory'))
    .filter((row) => lower(row.BranchId || 'main') === branch
      && (!clean(row.OrganisationEdition || row.OrganizationEdition)
        || lower(row.OrganisationEdition || row.OrganizationEdition) === 'school'))
    .map(({ __name, __updateTime, __createTime, ...row }) => row);
  return { ok: true, inventory };
}

export async function recordTuckShopStaffSale(env, user = {}, body = {}) {
  const staff = await scopedStaff(env, user);
  const customer = borrowerFrom(body.CustomerRef, 'Staff', [], staff);
  const method = lower(body.PaymentMethod);
  if (method === 'paystack online' || method === 'student wallet') {
    throw failure('Choose Cash, Bank Transfer or POS / Card for a staff sale.');
  }
  try {
    return await recordManualOrganizationCommerceSale(env, 'tuckShop', {
      ...body, CustomerType: 'Staff', CustomerRef: customer.BorrowerRef,
      CustomerName: customer.BorrowerName, CustomerEmail: '', CustomerPhone: ''
    }, { ...user, branchId: branchId(user), edition: 'school' });
  } catch (error) {
    if ([409, 412].includes(Number(error.status)) && /precondition|concurrent|version|transaction/i.test(clean(error.message))) {
      throw failure('The item stock changed during checkout. Refresh the catalogue and try again.', 409);
    }
    throw error;
  }
}
