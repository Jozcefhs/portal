import { getAccountsOverview } from './backend.js';
import { listCollection, requireFirestoreEnv } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { getSchoolStructure, listSchoolCollection, schoolSectionFor } from '../lib/school-scope.js';
import { configuredStaffBranches } from '../lib/staff-branch-context.js';
import { normalizeClassKey } from '../lib/class-names.js';
import { readJsonBody } from '../lib/request-security.js';

function clean(value) {
  return String(value ?? '').trim();
}

function toNumber(value) {
  const number = Number(String(value ?? '0').replace(/,/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function publicRows(rows, limit = 50) {
  return (rows || []).slice(0, limit).map((row) => {
    const copy = { ...row };
    delete copy.WalletPinHash;
    delete copy.PasswordHash;
    return copy;
  });
}

function sortRecent(rows, dateKeys) {
  return [...(rows || [])].sort((a, b) => {
    const av = dateKeys.map((key) => a[key]).find(Boolean) || '';
    const bv = dateKeys.map((key) => b[key]).find(Boolean) || '';
    return String(bv).localeCompare(String(av));
  });
}

function accountKey(value) {
  return clean(value).toLowerCase();
}

function isBoardingStudent(row) {
  const value = clean(row.StudentType || row.studentType || row.BoardingPreference || row.boardingPreference || row.ResidencyType || row.residencyType || row.Tags).toLowerCase();
  return /board(ing|er)?|hostel|resident/.test(value) && !/non[- ]?boarding/.test(value);
}

function reconcileInvoiceDisplay(invoices, accounts) {
  const accountMap = new Map();
  (accounts || []).forEach((account) => {
    const keys = [
      account.AccountRef,
      account.AdmissionNo,
      account.ApplicationReference,
      account.__id
    ].map(accountKey).filter(Boolean);
    keys.forEach((key) => accountMap.set(key, account));
  });
  return (invoices || []).map((invoice) => {
    const account = accountMap.get(accountKey(invoice.AccountRef)) ||
      accountMap.get(accountKey(invoice.AdmissionNo)) ||
      accountMap.get(accountKey(invoice.ApplicationReference));
    if (!account || toNumber(account.OutstandingBalance) > 0) return invoice;
    const debit = toNumber(invoice.Debit || invoice.Amount);
    const currentCredit = toNumber(invoice.Credit || invoice.PaidAmount);
    return {
      ...invoice,
      Credit: currentCredit > 0 ? currentCredit : debit,
      Balance: 0,
      Status: 'Paid'
    };
  });
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const allowed = new Set(user.allowedSections || []);
    if (!allowed.size && user.subscriptionActive !== false) {
      const err = new Error('Your staff role does not currently have a web dashboard section assigned.');
      err.status = 403;
      throw err;
    }
    const body = await readJsonBody(request, { maxBytes: 32 * 1024 });
    const requestedSection = clean(body.section);
    const shellOnly = clean(body.mode).toLowerCase() === 'shell';
    const schoolInsights = requestedSection === 'schoolInsights';
    if (!shellOnly && user.subscriptionActive === false) {
      const err = new Error(user.subscriptionMessage || 'This subscription is not active. Choose a paid subscription to continue.');
      err.status = 402;
      throw err;
    }
    if (schoolInsights && (user.edition !== 'school' || !allowed.has('accounts'))) {
      const err = new Error('School Insights requires school-edition Accounts access.');
      err.status = 403;
      throw err;
    }
    if (requestedSection && !schoolInsights && !allowed.has(requestedSection)) {
      const err = new Error('That dashboard section is not assigned to this staff account.');
      err.status = 403;
      throw err;
    }
    if (shellOnly) {
      const structure = await getSchoolStructure(env);
      const configuredBranches = configuredStaffBranches(structure);
      const branches = user.canSwitchBranches
        ? configuredBranches
        : configuredBranches.filter((branch) => branch.id.toLowerCase() === clean(user.assignedBranchId).toLowerCase());
      return Response.json({
        ok: true,
        message: 'Staff workspace ready.',
        user,
        allowedSections: user.allowedSections,
        availableSections: user.availableSections,
        restrictedSections: user.restrictedSections,
        subscriptionPlan: user.subscriptionPlan,
        subscriptionActive: user.subscriptionActive,
        subscriptionReadOnly: user.subscriptionReadOnly,
        subscriptionState: user.subscriptionState,
        subscriptionStatus: user.subscriptionStatus,
        trialStartedAt: user.trialStartedAt,
        trialEndsAt: user.trialEndsAt,
        trialDaysRemaining: user.trialDaysRemaining,
        paidThroughAt: user.paidThroughAt,
        renewalDueAt: user.renewalDueAt,
        gracePeriodEndsAt: user.gracePeriodEndsAt,
        dataRetentionEndsAt: user.dataRetentionEndsAt,
        subscriptionMessage: user.subscriptionMessage,
        summary: {},
        charts: {},
        departments: {},
        branches,
        defaultBranchId: clean(structure.ActiveBranchId || configuredBranches[0]?.id || 'main'),
        summaryDeferred: true
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const shouldLoad = (section) => {
      if (schoolInsights && ['accounts', 'students'].includes(section)) return true;
      return allowed.has(section)
        && (!requestedSection || requestedSection === section || (schoolInsights && ['admissions', 'formPurchases'].includes(section)));
    };
    const shouldLoadStore = () => ['bookstore', 'uniformStore', 'organizationStore']
      .some((section) => shouldLoad(section));

    const [
      applications,
      students,
      formSales,
      payments,
      invoices,
      ledger,
      clinicRecords,
      clinicInventory,
      kitchenInventory,
      clinicMovements,
      kitchenMovements,
      restaurantInventory,
      restaurantMovements,
      tuckShopInventory,
      tuckShopMovements
      ,storeItems
      ,storeOrders
    ] = await Promise.all([
      shouldLoad('admissions') ? listSchoolCollection(env, 'applications', {
        branchId: user.branchId,
        schoolSectionAccess: user.schoolSectionAccess
      }) : Promise.resolve([]),
      shouldLoad('students') ? listSchoolCollection(env, 'students', {
        branchId: user.branchId,
        schoolSectionAccess: user.schoolSectionAccess
      }) : Promise.resolve([]),
      shouldLoad('formPurchases') ? listCollection(env, 'formSales') : Promise.resolve([]),
      shouldLoad('accounts') ? listCollection(env, 'payments') : Promise.resolve([]),
      shouldLoad('accounts') ? listCollection(env, 'invoices') : Promise.resolve([]),
      (shouldLoad('accounts') || shouldLoad('tuckShop')) ? listCollection(env, 'ledger') : Promise.resolve([]),
      shouldLoad('clinic') ? listCollection(env, 'clinicRecords') : Promise.resolve([]),
      shouldLoad('clinic') ? listCollection(env, 'clinicInventory') : Promise.resolve([]),
      shouldLoad('kitchen') ? listCollection(env, 'kitchenInventory') : Promise.resolve([]),
      shouldLoad('clinic') ? listCollection(env, 'clinicMovements') : Promise.resolve([]),
      shouldLoad('kitchen') ? listCollection(env, 'kitchenMovements') : Promise.resolve([]),
      shouldLoad('restaurant') ? listCollection(env, 'restaurantInventory') : Promise.resolve([]),
      shouldLoad('restaurant') ? listCollection(env, 'restaurantMovements') : Promise.resolve([]),
      shouldLoad('tuckShop') ? listCollection(env, 'tuckShopInventory') : Promise.resolve([]),
      shouldLoad('tuckShop') ? listCollection(env, 'tuckShopMovements') : Promise.resolve([]),
      shouldLoadStore() ? listCollection(env, 'storeItems') : Promise.resolve([]),
      shouldLoadStore() ? listCollection(env, 'storeOrders') : Promise.resolve([])
    ]);

    const staffScope = (rows) => rows.filter((row) => {
      const rowBranch = clean(row.BranchId || 'main').toLowerCase();
      const branchAllowed = !clean(user.branchId) || rowBranch === clean(user.branchId).toLowerCase();
      const sectionAccess = clean(user.schoolSectionAccess || 'All').toLowerCase();
      // Legacy untagged records are inferred from class; records with no class are
      // treated as Secondary so switching to Primary presents a separate school.
      const rowSection = schoolSectionFor(row);
      const sectionAllowed = sectionAccess === 'all' || rowSection === sectionAccess;
      return branchAllowed && sectionAllowed;
    });
    let accountOverview = null;
    if (shouldLoad('accounts')) {
      try {
        const overviewInputs = {
          payments: staffScope(payments),
          invoices: staffScope(invoices),
          ledger: staffScope(ledger)
        };
        if (schoolInsights || shouldLoad('admissions')) overviewInputs.applications = applications;
        if (schoolInsights || shouldLoad('students')) overviewInputs.students = students;
        accountOverview = await getAccountsOverview(env, overviewInputs, {
          branchId: user.branchId,
          schoolSectionAccess: user.schoolSectionAccess
        });
      } catch (_err) {
        accountOverview = null;
      }
    }
    const displayInvoices = reconcileInvoiceDisplay(invoices, accountOverview && accountOverview.ok ? accountOverview.accounts : []);
    const visibleApplications = staffScope(applications);
    const visibleStudents = staffScope(students);
    const visibleFormSales = staffScope(formSales);
    const visibleClinicRecords = staffScope(clinicRecords);
    const visibleClinicMovements = staffScope(clinicMovements);
    const visibleKitchenMovements = staffScope(kitchenMovements);
    const visibleRestaurantMovements = staffScope(restaurantMovements);
    const visiblePayments = staffScope(payments);
    const visibleInvoices = staffScope(displayInvoices);
    const visibleLedger = staffScope(ledger);
    const visibleStoreItems = staffScope(storeItems);
    const visibleStoreOrders = staffScope(storeOrders);
    const visibleClinicInventory = staffScope(clinicInventory);
    const visibleKitchenInventory = staffScope(kitchenInventory);
    const visibleRestaurantInventory = staffScope(restaurantInventory);
    const visibleTuckShopInventory = staffScope(tuckShopInventory);
    const visibleTuckShopMovements = staffScope(tuckShopMovements);
    const walletPurchases = visibleLedger.filter((row) => clean(row.EntryType).toLowerCase() === 'wallet purchase');
    const lowClinic = visibleClinicInventory.filter((row) => toNumber(row.ReorderLevel) > 0 && toNumber(row.Quantity) <= toNumber(row.ReorderLevel));
    const lowKitchen = visibleKitchenInventory.filter((row) => toNumber(row.ReorderLevel) > 0 && toNumber(row.Quantity) <= toNumber(row.ReorderLevel));
    const lowRestaurant = visibleRestaurantInventory.filter((row) => toNumber(row.ReorderLevel) > 0 && toNumber(row.Quantity) <= toNumber(row.ReorderLevel));
    const lowTuckShop = visibleTuckShopInventory.filter((row) => toNumber(row.ReorderLevel) > 0 && toNumber(row.Quantity) <= toNumber(row.ReorderLevel));

    const allDepartments = {
      admissions: publicRows(sortRecent(visibleApplications, ['SubmittedAt', 'UpdatedAt', 'Timestamp']), 80),
      students: publicRows(sortRecent(visibleStudents, ['UpdatedAt', 'EnrolledAt', 'CreatedAt']), visibleStudents.length),
      formPurchases: publicRows(sortRecent(visibleFormSales, ['PaymentDate', 'UpdatedAt', 'CreatedAt']), 80),
      accounts: {
        payments: publicRows(sortRecent(visiblePayments, ['PaidAt', 'Date', 'RecordedAt']), 80),
        invoices: publicRows(sortRecent(visibleInvoices, ['Date', 'CreatedAt', 'DueDate']), 80),
        ledger: publicRows(sortRecent(visibleLedger, ['Date', 'CreatedAt']), 100)
      },
      clinic: {
        records: publicRows(sortRecent(visibleClinicRecords, ['Date', 'CreatedAt']), 80),
        inventory: publicRows(sortRecent(visibleClinicInventory, ['LastUpdated', 'UpdatedAt']), 80),
        lowStock: publicRows(lowClinic, 80),
        movements: publicRows(sortRecent(visibleClinicMovements, ['Date', 'CreatedAt']), 80)
      },
      kitchen: {
        inventory: publicRows(sortRecent(visibleKitchenInventory, ['LastUpdated', 'UpdatedAt']), 80),
        lowStock: publicRows(lowKitchen, 80),
        movements: publicRows(sortRecent(visibleKitchenMovements, ['Date', 'CreatedAt']), 80)
      },
      restaurant: {
        inventory: publicRows(sortRecent(visibleRestaurantInventory, ['LastUpdated', 'UpdatedAt']), 80),
        lowStock: publicRows(lowRestaurant, 80),
        movements: publicRows(sortRecent(visibleRestaurantMovements, ['Date', 'CreatedAt']), 80)
      },
      tuckShop: {
        purchases: publicRows(sortRecent(walletPurchases, ['Date', 'CreatedAt']), 100),
        inventory: publicRows(sortRecent(visibleTuckShopInventory, ['LastUpdated', 'UpdatedAt']), 100),
        lowStock: publicRows(lowTuckShop, 100),
        movements: publicRows(sortRecent(visibleTuckShopMovements, ['Date', 'CreatedAt']), 100)
      },
      bookstore: {
        items: publicRows(visibleStoreItems.filter((row) => clean(row.StoreType) === 'Bookstore'), 200),
        orders: publicRows(sortRecent(visibleStoreOrders.filter((row) => clean(row.StoreType) === 'Bookstore'), ['PaidAt', 'CreatedAt']), 200)
      },
      uniformStore: {
        items: publicRows(visibleStoreItems.filter((row) => clean(row.StoreType) === 'Uniform Store'), 200),
        orders: publicRows(sortRecent(visibleStoreOrders.filter((row) => clean(row.StoreType) === 'Uniform Store'), ['PaidAt', 'CreatedAt']), 200)
      },
      organizationStore: {
        items: publicRows(visibleStoreItems.filter((row) => clean(row.StoreType) === 'Organisation Store'), 200),
        orders: publicRows(sortRecent(visibleStoreOrders.filter((row) => clean(row.StoreType) === 'Organisation Store'), ['PaidAt', 'CreatedAt']), 200)
      }
    };
    const departments = Object.fromEntries(Object.entries(allDepartments).filter(([key]) => (
      requestedSection ? key === requestedSection : allowed.has(key)
    )));
    const summary = {};
    if (shouldLoad('admissions')) summary.applications = visibleApplications.length;
    if (shouldLoad('students')) {
      summary.students = visibleStudents.length;
      summary.activeStudents = visibleStudents.filter((row) => !/inactive|withdrawn|disabled/i.test(clean(row.Status))).length;
      summary.boardingStudents = visibleStudents.filter(isBoardingStudent).length;
      summary.dayStudents = visibleStudents.length - summary.boardingStudents;
    }
    if (shouldLoad('formPurchases')) summary.formPurchases = visibleFormSales.length;
    if (shouldLoad('accounts')) {
      summary.payments = visiblePayments.length;
      summary.invoices = visibleInvoices.length;
    }
    if (shouldLoad('clinic')) {
      summary.clinicRecords = visibleClinicRecords.length;
      summary.clinicInventory = visibleClinicInventory.length;
      summary.lowClinicStock = lowClinic.length;
    }
    if (shouldLoad('kitchen')) {
      summary.kitchenInventory = visibleKitchenInventory.length;
      summary.lowKitchenStock = lowKitchen.length;
    }
    if (shouldLoad('restaurant')) {
      summary.restaurantInventory = visibleRestaurantInventory.length;
      summary.lowRestaurantStock = lowRestaurant.length;
    }
    if (shouldLoad('organizationStore')) {
      summary.organizationStoreItems = visibleStoreItems.filter((row) => clean(row.StoreType) === 'Organisation Store').length;
      summary.organizationStoreOrders = visibleStoreOrders.filter((row) => clean(row.StoreType) === 'Organisation Store').length;
    }
    if (shouldLoad('tuckShop')) {
      summary.tuckShopPurchases = walletPurchases.length;
      summary.tuckShopInventory = visibleTuckShopInventory.length;
      summary.lowTuckShopStock = lowTuckShop.length;
    }

    const countBy = (rows, getter) => Object.entries(rows.reduce((out, row) => {
      const key = clean(getter(row)) || 'Unspecified'; out[key] = (out[key] || 0) + 1; return out;
    }, {})).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    const accountRows = accountOverview && accountOverview.ok ? staffScope(accountOverview.accounts || []) : [];
    const classBalanceGroups = accountRows.reduce((out, row) => {
      const original = clean(row.ClassName) || 'Unspecified';
      const key = normalizeClassKey(original) || 'unspecified';
      out[key] = out[key] || { label: original, value: 0 };
      out[key].value += Math.max(0, toNumber(row.OutstandingBalance ?? row.Balance));
      return out;
    }, {});
    const classBalances = Object.values(classBalanceGroups).sort((a, b) => b.value - a.value);
    const charts = {
      studentGender: countBy(visibleStudents, (row) => row.Gender),
      studentCategory: countBy(visibleStudents, (row) => row.EnrollmentCategory || row.IntakeCategory || 'Returning'),
      classBalances,
      topDefaulters: accountRows.filter((row) => toNumber(row.OutstandingBalance ?? row.Balance) > 0)
        .sort((a, b) => toNumber(b.OutstandingBalance ?? b.Balance) - toNumber(a.OutstandingBalance ?? a.Balance)).slice(0, 10)
        .map((row) => ({ label: clean(row.DisplayName || row.AccountRef), secondary: clean(row.ClassName), value: toNumber(row.OutstandingBalance ?? row.Balance) }))
    };

    if (schoolInsights) {
      const totalInvoiced = accountRows.reduce((sum, row) => sum + Math.max(0, toNumber(row.TotalDebit)), 0);
      const totalPaid = accountRows.reduce((sum, row) => sum + Math.max(0, toNumber(row.TotalCredit)), 0);
      const outstandingRows = accountRows
        .filter((row) => toNumber(row.OutstandingBalance ?? row.Balance) > 0)
        .sort((a, b) => toNumber(b.OutstandingBalance ?? b.Balance) - toNumber(a.OutstandingBalance ?? a.Balance));
      const outstandingFees = outstandingRows.reduce((sum, row) => sum + toNumber(row.OutstandingBalance ?? row.Balance), 0);
      summary.studentAccounts = accountRows.length;
      summary.totalInvoiced = totalInvoiced;
      summary.totalPaid = totalPaid;
      summary.outstandingFees = outstandingFees;
      summary.defaulters = outstandingRows.length;
      summary.collectionRate = totalInvoiced > 0 ? Math.min(100, totalPaid / totalInvoiced * 100) : 0;
      charts.paymentPosition = [
        { label: 'Expected', value: totalInvoiced },
        { label: 'Received', value: totalPaid },
        { label: 'Outstanding', value: outstandingFees }
      ];
      departments.schoolInsights = {
        defaulters: outstandingRows.slice(0, 10).map((row) => ({
          AccountRef: clean(row.AccountRef),
          AdmissionNo: clean(row.AdmissionNo),
          DisplayName: clean(row.DisplayName || row.AccountRef),
          ClassName: clean(row.ClassName),
          TotalDebit: toNumber(row.TotalDebit),
          TotalCredit: toNumber(row.TotalCredit),
          OutstandingBalance: toNumber(row.OutstandingBalance ?? row.Balance),
          LastPaymentAt: clean(row.LastPaymentAt)
        }))
      };
    }

    return Response.json({
      ok: true,
      message: 'Staff dashboard loaded.',
      user,
      allowedSections: user.allowedSections,
      availableSections: user.availableSections,
      restrictedSections: user.restrictedSections,
      subscriptionPlan: user.subscriptionPlan,
      summary,
      charts,
      departments
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return Response.json({ ok: false, message: err.message || String(err) }, { status: err.status || 500 });
  }
}
