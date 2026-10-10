# Branch-approved desktop finance access

Main Branch is a branch, not an organisation-wide device approval. Authorised
Accounts Officers and Super Admins can record manual payments from a device
approved for their branch without broadening its approval.

## Payment boundary

- The backend resolves the current staff role, branch and school-section access
  from the staff register. Device approval does not grant a finance role.
- A scoped payment requires an existing student or applicant in that scope.
  Account links and identity fields come from that saved record.
- Receipts, invoice allocation, ledger entries, accounting journals, gateway
  charges and account summaries are checked for ownership. Legacy Main records
  remain Main records; they are not reassigned to another branch by a request.
- Shared account references across branches/sections fail closed, including old
  imports stored under noncanonical document IDs. Finance must resolve the
  ambiguity rather than choosing a record implicitly.
- Reusing a payment reference requires the same account, fee, currency and
  credited amount. Concurrent creates are checked again, and version-conditional
  writes prevent replacing records changed during posting.
- Posted sibling-transfer actions may be inspected across school sections within
  the same branch. This does not permit changing the other section's account.

## Shared setup stays protected

Fee-component creation, bulk updates, deletion and default seeding operate on
the shared `feeItems` catalogue. These still require an organisation-wide approved
desktop device. The warning explains that distinction; do not approve every
branch laptop organisation-wide as a workaround.

This change does not introduce branch-specific fee catalogues or broaden other
unaudited finance actions. Existing organisation-wide and trusted gateway paths
retain their existing access model.

## Verification and rollout

`tests/manual-payment-branch-scope.test.mjs` exercises the real backend using
intercepted Firestore/OAuth requests, including Main/North, wallet top-ups,
applicant acceptance, school-fee invoices, retries, ownership conflicts and
concurrent writes. Tests do not post live financial records.

Publish the shared backend to activate this repair for installed desktop apps.
No device reapproval, saved-record migration or new desktop installer is needed.
