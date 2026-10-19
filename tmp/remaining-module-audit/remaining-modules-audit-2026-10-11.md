# Remaining Modules Audit

Date: 11 October 2026

The remaining-module review found **23 actionable defects** across School, Faith and Organisation editions. The most urgent risks are staff-account replacement, cross-branch access, disclosure of confidential information, lost records and incorrect inventory updates.

**Status:** Findings only; no application fixes, live-data changes, push, compilation or deployment were performed for this audit. Earlier pending application changes remain untouched. This checklist is separate from the earlier finance/accounting and academic repair lists.

## Scope and verification

The review covered shared staff management, settings and restore; HR, attendance, admissions, clinic, conduct and library; school stores, kitchen and hotel operations; Faith/Organisation membership, departments, services, programs and announcements. Records Desk, Executive Office and parent document access received focused source/test checks.

The complete current web suite passed **2,511 tests**. An additional **65 focused desktop tests** passed. Passing existing tests does not invalidate the defects below: isolated executions of the current source reproduced them using synthetic records and in-memory persistence.

No real payments, email, push notifications or database mutations were used. Browser/device end-to-end execution, actual notification delivery, exhaustive restaurant/vendor flow review and every desktop document-generation path remain outside this review. No additional confirmed defect emerged from the focused library, Records Desk or correspondence checks; this is not a guarantee that those modules are error-free.

P1 means high-priority repair for permission, data-integrity or core-workflow failure. P2 means an important functional or resilience repair. Every finding below is **open**.

## Shared account and configuration defects

### R01 New Staff Account can replace an existing account

**P1 — All editions, web Staff and Permissions.** New and edit forms submit the same save action. The server treats an existing username as an update, so creating an Admin using an existing Super Admin username changes that account and its password. The last-admin guard does not prevent this when another Super Admin exists. The synthetic save reproduced the user's earlier scenario.

Repair: distinguish create from edit, reject duplicate usernames on creation, and require the immutable original identity for updates. Use conditional writes to handle concurrent creation.

Source: [staff-users.js](<C:/Users/DYNAMAX/Documents/New project/portal/functions/api/staff-users.js:246>); [form submission](<C:/Users/DYNAMAX/Documents/New project/portal/js/admin.js:21436>).

### R02 Different usernames can overwrite the same staff document

**P1 — All editions, staff save/import.** Username lookup compares original names, but document IDs use lossy punctuation replacement. For example, `alice@example.com` and `alice-example.com` resolve to the same document ID. The second name is treated as new and bypasses the existing-account branch and Super Admin checks. A synthetic main-branch save overwrote the other-branch document.

Repair: enforce uniqueness at the storage ID and login-key levels, preserve immutable IDs for updates, and use create-only preconditions for new accounts.

Source: [ID normalization](<C:/Users/DYNAMAX/Documents/New project/portal/functions/api/staff-users.js:42>); [lookup and save](<C:/Users/DYNAMAX/Documents/New project/portal/functions/api/staff-users.js:252>).

### R03 Staff CSV import can remove the last Super Admin

**P1 — All editions.** Import accepts a role change for the only active Super Admin without applying the last-admin safeguard used by individual saves and deletes. A one-row synthetic import changed the sole Super Admin to Admin.

Repair: validate the final batch state, retaining at least one active Super Admin, and protect this invariant against concurrent updates.

Source: [importUsers](<C:/Users/DYNAMAX/Documents/New project/portal/functions/api/staff-users.js:362>).

### R04 Failed branch-settings reads can erase saved overrides

**P2 — All editions.** Any read failure is treated as a missing override document. A subsequent partial save then overwrites the whole document with only the submitted fields. A synthetic read outage followed by a phone-only update prepared a replacement containing only that phone field.

Repair: distinguish a confirmed missing document from an unavailable read; abort uncertain writes and preserve omitted fields with a version precondition.

Source: [branch-profile-settings.js](<C:/Users/DYNAMAX/Documents/New project/portal/functions/lib/branch-profile-settings.js:152>).

### R05 Restore can bypass identity protection after a read error

**P1 — All editions, shared restore.** Restore catches a failed live-settings read and treats it as absent. It then prepares backup workspace, edition and subscription values for writing instead of retaining the live identity. Redacted credentials can also fail to be retained.

Repair: stop the restore chunk if protected settings cannot be read; never treat an outage as permission to overwrite protected identity or credentials.

Source: [protectedRestoreDocument](<C:/Users/DYNAMAX/Documents/New project/portal/functions/lib/organization-backup.js:465>).

## People and school operations

### R06 New enrolments can be saved in the wrong branch

**P1 — School, desktop/backend enrolment using organisation-wide or legacy credentials.** The new student payload omits the applicant's authoritative branch, section and scoped path. Storage falls back to the organisation's active branch. An Annex application was marked Enrolled while its student was created under Main.

Repair: carry the applicant's verified scope into creation, validate actor access and keep student creation and application status consistent.

Source: [enrollStudent](<C:/Users/DYNAMAX/Documents/New project/portal/functions/api/backend.js:4261>); [scope fallback](<C:/Users/DYNAMAX/Documents/New project/portal/functions/lib/school-scope.js:194>).

### R07 Clinic records lose branch and school section

**P1 — School, legacy desktop/backend clinic and subsequent web display.** Saving drops branch and section even if supplied. Web filtering treats untagged records as Main, while the legacy retrieval route reads the entire collection. Annex records can disappear from Annex and appear in Main. Branch-bound device credentials currently block these legacy actions rather than making them correctly scoped.

Repair: resolve the selected student server-side, preserve scope and enforce scoped reads/writes and module access.

Source: [saveClinicRecord](<C:/Users/DYNAMAX/Documents/New project/portal/functions/api/backend.js:7238>); [clinic read](<C:/Users/DYNAMAX/Documents/New project/portal/functions/api/backend.js:11733>); [desktop payload](<C:/Users/DYNAMAX/Documents/New project/suite/modules/operations.py:663>).

### R08 Line managers can overwrite another team's review

**P1 — All editions, Human Resources.** The server checks the submitted username's reporting relationship, then loads an arbitrary review ID without verifying its existing owner. A manager can submit another employee's review ID with an authorised direct-report username and overwrite/reassign it.

Repair: authorise the stored review and its employee before update; reject silent identity reassignment.

Source: [savereview](<C:/Users/DYNAMAX/Documents/New project/portal/functions/api/staff-hr.js:378>).

### R09 Student Conduct ignores module entitlement

**P1 — School.** Role capability alone permits writes. A Principal on the actual Starter-plan flags had no Student Conduct section but successfully saved a case through the endpoint. The desktop bridge also supplies a hard-coded conduct section.

Repair: require effective module entitlement as well as role capability on both web and desktop routes.

Source: [conduct capability](<C:/Users/DYNAMAX/Documents/New project/portal/functions/lib/student-conduct.js:66>); [endpoint](<C:/Users/DYNAMAX/Documents/New project/portal/functions/api/staff-conduct.js:13>); [desktop bridge](<C:/Users/DYNAMAX/Documents/New project/portal/functions/api/backend.js:11195>).

### R10 Manual attendance corrections leave incorrect totals

**P2 — All editions, Staff Attendance.** The correction path retains the earliest clock-in/latest clock-out, so correcting clock-in later has no effect. Moving clock-in earlier after clock-out changes the timestamp but leaves WorkMinutes stale. The probe produced endpoints representing 600 minutes with a stored total of 540.

Repair: implement explicit authorised timestamp replacement and recalculate every derived daily metric from the corrected endpoints.

Source: [attendance calculation](<C:/Users/DYNAMAX/Documents/New project/portal/functions/lib/staff-time-attendance.js:555>).

## Stock and commerce

### R11 Paid school-store orders do not deduct normally created stock

**P1 — School Books and Supplies and Clothing and Supplies.** Payment confirmation reconstructs legacy unscoped inventory IDs, while web creation/import uses branch/section-qualified IDs. A paid synthetic order for an item with five available units left stock at five and recorded InventoryStatus as Review Required. Online payments and approved direct transfers share this handler.

Repair: carry verified immutable inventory IDs through checkout and confirmation, with scoped legacy compatibility.

Source: [storeItemDemand](<C:/Users/DYNAMAX/Documents/New project/portal/functions/api/verify-payment.js:44>); [web item identity](<C:/Users/DYNAMAX/Documents/New project/portal/functions/api/staff-stores.js:122>); [import identity](<C:/Users/DYNAMAX/Documents/New project/portal/functions/lib/item-import.js:93>).

### R12 Organisation Store bank transfers fail product lookup on approval

**P1 — Faith and Organisation public stores.** Transfer initiation saves the inventory document ID in Reference, but approval resolves that value as ItemCode. The valid synthetic purchase failed with an item-not-found error.

Repair: use a consistent immutable inventory identity from initiation to approval and enforce its branch.

Source: [saved transfer payload](<C:/Users/DYNAMAX/Documents/New project/portal/functions/lib/organization-commerce.js:756>); [item lookup](<C:/Users/DYNAMAX/Documents/New project/portal/functions/lib/organization-commerce.js:282>).

### R13 Hotel staff can override their authorised branch

**P1 — Faith and Organisation hotel operations.** The branch helper prioritises client-supplied BranchId over the authenticated branch. A Main Hotel User changed another branch's room. The same helper supports listings, reservations and payments.

Repair: derive scope from the verified actor; allow branch switching only through an authorised branch-switch policy.

Source: [hotel branch selection](<C:/Users/DYNAMAX/Documents/New project/portal/functions/lib/hotel-services.js:77>).

### R14 Concurrent hotel reservations can double-book a room

**P1 — Faith and Organisation.** Availability checking and reservation writing are separate unconditional operations. Two simultaneous requests for the same room and dates both succeeded. Public booking uses the same unprotected check-then-write pattern.

Repair: use an atomic shared room/date allocation guard or equivalent transactional reservation mechanism.

Source: [staff reservation save](<C:/Users/DYNAMAX/Documents/New project/portal/functions/lib/hotel-services.js:322>); [public booking](<C:/Users/DYNAMAX/Documents/New project/portal/functions/lib/hotel-services.js:667>).

### R15 Reservation saving bypasses guarded check-in

**P1 — Faith and Organisation.** Saving a reservation accepts Checked In directly, bypassing the dedicated payment and transition checks. The probe saved an unpaid Checked In reservation while its room remained Available.

Repair: create reservations in Reserved state; preserve status on ordinary edits and use the guarded transition operation for check-in/out.

Source: [reservation save](<C:/Users/DYNAMAX/Documents/New project/portal/functions/lib/hotel-services.js:309>).

### R16 Simultaneous kitchen or clinic stock movements lose deductions

**P1 — School.** Inventory and movement records are written separately without a version check. Two seven-unit issues against ten available units both succeeded: stock showed three, while the movement ledger recorded fourteen issued.

Repair: atomically commit stock and movement with a version/availability condition, plus stable request IDs for safe retries.

Source: [recordMovement](<C:/Users/DYNAMAX/Documents/New project/portal/functions/api/staff-departments.js:201>).

### R17 Legacy desktop inventory creates duplicates and negative stock

**P1 — School kitchen and clinic.** The backend selects an item globally by name, permits a negative resulting quantity and writes a name-only document ID. Web/import-created stock uses scoped IDs. The probe selected Main stock for an other-branch request and created a duplicate negative-stock record.

This path is reachable with organisation-wide/legacy desktop credentials; branch-bound devices currently block these actions.

Repair: use the shared scoped inventory handlers, immutable IDs, nonnegative-stock validation and atomic writes.

Source: [legacy stock lookup](<C:/Users/DYNAMAX/Documents/New project/portal/functions/api/backend.js:7266>); [quantity and ID write](<C:/Users/DYNAMAX/Documents/New project/portal/functions/api/backend.js:7324>).

## Faith and Organisation operations

### R18 Department listing exposes confidential pastoral notes

**P1 — Faith and Organisation records using the shared schema.** The department response includes raw member documents. A Membership Officer who is explicitly denied pastoral-note access receives PastoralNotes through this alternate endpoint.

Repair: use the existing capability-based member sanitizer before constructing every response, including desktop department data.

Source: [department list response](<C:/Users/DYNAMAX/Documents/New project/portal/functions/lib/organization-departments.js:725>).

### R19 Editing a member erases fields not present in the form

**P1 — Faith and Organisation web member editing.** The form edits nine fields, but the backend normalizes omitted fields to blanks and overlays them on existing data. Changing a phone number erased household, date of birth, address and notes in the probe. A Super Admin edit also erased omitted pastoral notes.

Repair: preserve unspecified fields, distinguish omission from an explicit clear and retain sensitive-field permissions.

Source: [member save](<C:/Users/DYNAMAX/Documents/New project/portal/functions/lib/church-membership.js:283>); [web form](<C:/Users/DYNAMAX/Documents/New project/portal/js/admin.js:6823>).

### R20 Department offering submission bypasses remittance confirmation

**P1 — Faith and Organisation shared department backend.** A Church Administrator may submit offerings but not confirm remittance. Supplying PaymentMethod Transfer and PaymentStatus Paid nevertheless marks the offering/remittance paid without consulting a verified payment record.

Repair: ignore client-paid assertions; require authoritative provider verification or the explicit authorised remittance-confirmation path.

Source: [offering save](<C:/Users/DYNAMAX/Documents/New project/portal/functions/lib/organization-departments.js:608>).

### R21 Organisation roles are denied modules shown in navigation

**P2 — Organisation.** Services, membership and department capabilities recognise Faith roles but omit native Organisation leadership/records roles. Executive Director, Organisation Administrator, Operations Manager and Records Officer receive Services navigation yet cannot view it through the service capability check. Related department/personnel/program actions are also affected.

Repair: define an edition-aware role/capability mapping consistently across navigation and backend enforcement.

Source: [services roles](<C:/Users/DYNAMAX/Documents/New project/portal/functions/lib/church-services.js:19>); [department roles](<C:/Users/DYNAMAX/Documents/New project/portal/functions/lib/organization-departments.js:26>).

### R22 Organisation announcements omit Organisation staff

**P2 — Organisation web notifications.** The route uses the church announcement workflow, whose audience builder filters with a hard-coded church edition. One active Organisation-tagged staff member yielded zero recipients. Native Organisation leaders are also absent from the composer role allowlist.

Repair: pass the verified deployment edition into both composer authorisation and recipient selection.

Source: [notification routing](<C:/Users/DYNAMAX/Documents/New project/portal/functions/api/staff-notifications.js:33>); [audience filter](<C:/Users/DYNAMAX/Documents/New project/portal/functions/lib/church-announcements.js:118>).

### R23 Replacing attendance totals retains stale breakdowns

**P2 — Faith and Organisation services.** Clearing optional breakdown fields omits them from the update, leaving old values stored. The probe changed attendance total from 100 to five but retained children/adults totalling 100.

Repair: apply explicit clearing semantics for the replacement form and validate the complete resulting record.

Source: [attendance total replacement](<C:/Users/DYNAMAX/Documents/New project/portal/functions/lib/church-services.js:439>).

## Lower priority hardening observations

These are separate from the 23 main findings.

- **Existing department assignments can be reset by stale batch requests.** Reassignment overwrites position, joining date and status. Current UI disables already-assigned people, so exposure requires a stale form, retry or concurrent assignment. Preserve or skip existing assignments. [batch assignment](<C:/Users/DYNAMAX/Documents/New project/portal/functions/lib/organization-departments.js:456>).
- **Visitor attendance accepts a missing reference.** Multiple visitors can normalize to the same attendance key. Current clients generate references; reject missing identities or generate unique server-side IDs. [visitor identity](<C:/Users/DYNAMAX/Documents/New project/portal/functions/lib/church-services.js:108>).
- **Desktop Bulk Send allows overlapping runs.** Confirming Send twice queues duplicate batches. Mocked delivery reproduced this; no real email was sent. Add an in-progress guard and disable Send while active. This is a lower-priority usability/retry safeguard, not a demonstrated permission bypass.

## Repair order

1. Staff identity and last-admin protection; HR, hotel and clinic scope; pastoral-note privacy; remittance authorisation.
2. Enrolment/member data preservation; stock identity and atomic movement; guarded hotel booking/check-in.
3. Branch-settings/restore failure handling; edition role/notification parity; attendance corrections; lower-priority hardening.

For each repair, convert its synthetic reproduction into a permanent regression test, cover applicable editions and scope variants, then rerun the full suites. Existing records affected by earlier failures require a separate, reviewed reconciliation; code fixes alone cannot safely infer missing historical values.

## Reproduction files

All database adapters in these probes are in-memory:

- [Shared account settings and restore probes](<C:/Users/DYNAMAX/Documents/New project/portal/tmp/remaining-module-audit/shared-probes.mjs:1>)
- [People and school operations probes](<C:/Users/DYNAMAX/Documents/New project/portal/tmp/remaining-module-audit/people-probes.mjs:1>)
- [Stock and commerce probes](<C:/Users/DYNAMAX/Documents/New project/portal/tmp/remaining-module-audit/commerce-probes.mjs:1>)
- [Faith and Organisation probes](<C:/Users/DYNAMAX/Documents/New project/portal/tmp/remaining-module-audit/faith-org-probes.mjs:1>)
- [Desktop bulk send probe](<C:/Users/DYNAMAX/Documents/New project/suite/tmp/remaining-module-audit/bulk-email-probe.py:1>)

