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
