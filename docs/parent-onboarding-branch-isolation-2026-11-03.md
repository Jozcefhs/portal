# Parent onboarding: exact learner and branch identity

School codes and admission numbers may repeat in different branches. They are not authentication credentials and must never select a private learner profile on their own.

The previous completion page accepted an admission number with a common temporary password, and the first-password step selected an awaiting-password student by email. Although the admission lookup rejected known duplicates, it had no proof identifying the intended learner or branch. The reported live incident has not yet been traced to particular records: the admission number and intended/actual branches are still required for that review.

## Repair

- Students → the learner's link icon issues a personal, expiring link. The authenticated working branch, school section, exact collection and document ID are checked before issuance. Ambiguous legacy edit requests are rejected.
- The link signs the project, workspace, edition, branch, section, document ID, admission number, expiry and a cryptographically random nonce. Only its hash is saved. It expires after seven days; reissue invalidates earlier links.
- Opening the page performs no learner lookup. Continue verifies the signed identity and reads exactly that one learner. Missing, moved, expired, mismatched or unavailable records never trigger an admission-number fallback into another branch.
- Branch and section appear beside the learner's name and class. The access token is removed from the URL after opening and is not saved in browser storage. After refreshing, reopen the personal link received from the school.
- Profile submission uses a revision-guarded field patch on the exact document. All placements, scores and unrelated records are preserved. New parents go directly to private-password setup. There is no common-password/email-only setup path.
- Password creation and completion are committed atomically. Existing credentials cannot be overwritten. Completion consumes the link; concurrent attempts and retries cannot create duplicate credentials. A password reset racing with setup cannot issue a session using the replacement credential.
- Desktop backend import/reissue returns the same personal link; imported student duplicate checks use branch and section. No desktop installer was built or released.

Old shared links with the common temporary password are intentionally no longer accepted. Staff must issue a personal link from the intended learner row. Existing parent sign-in, password recovery and issued family verification codes remain available.

## Validation

`node --test tests/*.test.mjs tests/payroll/*.test.mjs`: 4,517 passing tests at this change, including 13 new tests for repeated admission numbers across branches/sections, legacy roots, invalid and rotated proofs, unavailable records, staff scope, concurrent password setup and full endpoint completion.

`tests/parent-onboarding-browser.mjs`: isolated local browser checks at 390px and 1280px using the actual parent HTML/JavaScript and synthetic responses. Confirmed no automatic learner load, visible branch identity, direct password setup, no token in browser storage and no JavaScript errors.

No production learner, parent credential, payment, invoice or score record was modified during verification. The affected family's existing association still needs a targeted review once the admission number and branches are identified.
