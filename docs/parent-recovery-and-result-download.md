# Parent recovery and result downloads — 30 October 2026

The staff biometric controls now use an inline fingerprint icon instead of a corrupted encoded character. The parent sign-in screen explicitly asks for the registered parent email, not a student's admission number.

## Forgotten passwords

Open **Forgot password?** from the parent sign-in page. Enter the email registered with the school, copy the emailed recovery code, then enter and confirm a new password. Codes expire after 15 minutes and can be used only once. Delivery uses the school's existing configured email provider.

Recovery applies to an existing parent password. First-time parents still use the school-issued Parent Login Code. Parents without access to their registered email must contact the school; recovery cannot redirect a code to another email address.

The endpoint returns the same acknowledgement for known and unknown accounts, rate-limits requests, and saves only a hash of the recovery code. An atomic version-checked commit changes the password, consumes the code and writes one audit entry. Old sessions are invalidated; a password change during sign-in cannot revive them. Password/session checks use exact credential lookups, with no student or financial history scans. Tokens are excluded from backups.

## Result downloads

An accessible academic result now has **Download PDF** beside **Print result**. Download rechecks the existing parent/result access policy through the print endpoint, then renders the same report in the browser. Published status, linked-child access and financial-clearance policy remain enforced. Restricted results cannot be downloaded.

The PDF libraries load only when requested. No server PDF service or additional database writes are introduced. Long reports split at row boundaries and repeat subject headings; subjects remain on one line. The PDF preserves the report visually as images rather than selectable text.

## Verification

- Full automated test suite: 4,377 tests passed.
- Browser tests cover actual one- and two-page PDF files, lazy loading, access denial, parent email validation, password confirmation and mobile layout.
- Every generated PDF page was rendered and visually inspected, including long subject names and repeated headings.
- Parent result print-layout parity checks passed for Nursery, Primary and Secondary.
- Recovery tests cover expiry, single use, concurrent retries, account/workspace mismatch, session revocation and record preservation. Email delivery was mocked; no live parent was emailed or reset.
- Web release metadata: `dynamax-v525-parent-recovery-result-download`.

No student, score, payment or family-link migration is required. No desktop installer compilation or release is included.

## Production verification

Source commit: `be4dd8b4baa6ce06f353a66ab1289c43af319915` on `codex/school-score-register-release`.

Deployed to `https://destinychristianacademy.pages.dev` through deployment `https://eb3b186c.destinychristianacademy.pages.dev`. Eight read-only/invalid-action checks verified the release marker, fingerprint icon, recovery page with no-store headers, parent recovery link, exact source content for the download helper and PDF library, and recovery endpoint availability. The endpoint check supplied an unsupported action, so it requested no email and changed no account. Live inbox delivery was not tested.

## Recovery delivery investigation — 13 November 2026

The later repair in `0ebb9725` sends parent recovery to the validated credential identity even when an older credential lacks a separate `Email` field. Parent and staff recovery records also retain safe provider acceptance/failure metadata. Acceptance is not proof of inbox delivery. The clean candidate passed 205 focused tests, including recovery single-use, concurrent requests and preservation checks, and was deployed.

The owner authorised inspection of the signed-in Brevo transactional logs. For **6–13 November**, the subject **Parent portal password recovery** had **15 Sent and 15 Delivered events**. The combined filters for Hard bounce, Soft bounce, Error, Blocked, Deferred, Invalid Email, Complaint and Unsubscribed returned **zero events**. These are provider delivery events, not proof of inbox placement. Repeated opening events are not additional emails.

A bounded read of the latest 20 parent recovery records found **16 used codes**. Eleven of the 15 records from the checked Brevo date range were used. This verifies successful password resets in addition to delivery; it does not establish why any individual reported a missing email before requesting another code.

The subject **Staff password recovery** returned **zero events for 1 October–13 November**. The latest six staff request timestamps were inspected with current login configuration, without reading passwords or recovery codes. Two requests matched active accounts with no saved recovery email; three did not match a current login; one matched an account that has a valid recovery email now, which does not prove it had one at the original request time. Of 276 saved staff accounts, 30 had a recovery email. These counts include saved accounts, not just active employees.

Staff recovery uses the **Password recovery email** in **Staff & permissions → Manage staff account**, or the email saved by the staff member in **Login details**. HR contact addresses and a request-supplied email must not silently become recovery destinations. The owner declined a deliberate live staff recovery test to avoid interrupting staff work. No test email or password reset should be triggered for an existing staff account. Live staff delivery remains unverified until an authorised, genuine recovery request provides evidence. Requesting a code alone does not change a password or invalidate a session; those changes occur only after a valid code and new password are submitted.

This investigation sent no emails and changed no credentials or business records. Direct provider-key access was not used; delivery evidence came from the authorised browser session. No compilation or installer release was performed.
