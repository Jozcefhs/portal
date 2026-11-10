# Student status and HR employment workflows — 10 November 2026

## Learner status

Status changes from Students, Accounts and linked enrolled Admissions now use the same branch- and section-scoped writer. A terminal status such as Expelled removes the learner from active classroom participation. Leave, suspension and inactivity retain a reversible placement. Existing scores, attendance, payments and closed-period memberships remain intact; changing status does not delete a pupil or financial record.

The profile, affected current memberships and linked admission display update together with saved-version checks. Admission offers and pre-enrolment milestones remain separate from learner status. Conflicting duplicate admission links require review rather than selecting an arbitrary record. Placement and identity changes must be saved separately from status changes. Retrying the same status without a material change adds no write or audit entry. An explicit same-status save can repair an inconsistent legacy current membership.

Current operational rosters also use the learner's saved status, including previously inactive profiles with stale active memberships. Closed-period history remains accessible. Profile reads are limited to the requested scope, shared within a batch, and reused when already fetched for display names.

## HR salary and letters

Open **Human Resources → Salary & letters**, select an employee and choose **Load employee setup**. This loads only that employee's salary profile and a bounded list of saved letters. Opening HR or switching away and back does not request every salary or letter. Loaded employee setup is retained; Refresh explicitly checks for changes.

The salary form reuses the existing payroll profile. It edits basic salary, named allowances and recurring deductions, retaining payroll tax, pension, bank and formula settings. Existing payroll runs, payslips and payments are not recalculated. Advanced configurable salary profiles remain managed in the existing Accounts editor and are displayed using the same payroll calculation logic.

Enter the employment terms, save a letter draft, then preview or download the PDF. The document includes the organisation/branch identity, employee details, position, department, dates, gross salary and component breakdown, agreed terms, signatory and acceptance space. Contract terms and salary values are entered by the organisation; they are not invented automatically.

Saved PDFs are immutable private R2 objects. Firestore retains only the scoped document reference and integrity metadata, not PDF bytes. Preview, download and send require authenticated employee/branch access and validate the saved object's scope, size, type and SHA-256. Listing HR does not download PDFs.

**Send employment letter** requires an explicit confirmation of the employee's saved email address and sends the saved PDF using the employee branch's effective email provider: its independent account when configured, otherwise the inherited organisation account. Salary, staff identity and draft versions are checked before sending. Changed details require a new draft. Repeated successful requests do not resend. An uncertain provider outcome is retained for review instead of automatically sending a duplicate. No actual employee email was sent during validation.

Salary access and letter issuing have separate server-enforced HR capabilities. Records are isolated by deployment edition, workspace, branch and stable employee identity, including after a username change. A selected branch cannot move another branch's employee salary.

The shared HR interface is supported across School, Faith, Other Organisation and the isolated Hospital demo. The Hospital demo currently has no email provider configured; saving/previewing/downloading works, while email delivery reports that setup is needed. No success is reported without provider acceptance.

## Branch email options

In branch Settings, choose **Inherit organisation provider** to retain shared delivery, or connect the branch's own **Brevo** or **Google** account. Branch sender and reply-to details remain available with either option. Existing branches inherit until an administrator explicitly connects an override.

Independent credentials are held in separate encrypted Cloudflare secrets and bound to the workspace and canonical branch. An invalid override reports a setup error rather than silently sending through another account. Setup requests, OAuth callbacks and deployment completion all retain the branch identity. Delayed retries cannot replace a newer transition. Uncertain deployment responses keep the transition pending for verification, and failed Google setup does not revoke grants that another branch may still use.

## Validation and delivery

The final School/shared suite passed **5,030 tests**. Focused tests cover status/history preservation, no-op retries, identity isolation, payroll preservation, draft and email deduplication, concurrent changes and provider failures. The email/sender review passed 352 checks. Browser checks cover desktop and mobile widths in all four editions. The generated two-page synthetic PDF was rendered and visually checked. Deployment evidence is maintained in `user-request-tracker.json`.

The HR and status changes are deployed through the web backend. The owner's latest instruction also authorizes compiling and releasing the pending desktop source fixes after outstanding release checks pass; that installer is tracked separately.
