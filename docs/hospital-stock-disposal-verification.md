# Hospital quarantine disposal verification

Verified on 4 November 2026. This web/backend increment is deployed only to the isolated Hospital Owner's Demo. It does not complete the remaining Hospital roadmap.

- Source commit: `8ce4629c152f2e190fb577f4603bb45bc5e7f764`, branch `codex/hospital-edition`.
- Deployment: [41f8dffa](https://41f8dffa.dynamax-hospital-review.pages.dev).
- Owner entry: [Quarantined stock disposal](https://dynamax-hospital-review.pages.dev/hospital.html?task=stock-disposal).
- Web marker: `dynamax-v527-hospital-stock-disposal`.
- Three additive indexes are READY in `dynamax-hospital-review`: disposal dates, pending/status dates, and selected disposal event history. No indexes or records were deleted.

## Automated checks

All 4,738 repository tests passed, including 24 new disposal service tests. All 14 Hospital browser workflows passed. The disposal browser checks use actual services with synthetic in-memory records and cover successful/failed submissions, independent witnessed approval, rejection, cancellation, lost responses, stale stock, retained evidence, pagination, explicit refresh, cached repeat loads, print previews, branch/session clearing, and 1366px/390px layouts.

Independent review found no accounting or access-control blocker. It identified stale cached details after register refresh; the fix invalidates those details without loading them automatically. Browser regressions confirm that a decision by another officer becomes visible after refreshing the queue or register. Older browser fixtures now discover the scripts/styles from the real Hospital page, preventing fixture-only missing-script failures when modules are added.

Fixed service budgets and immutable record expectations are covered in [the workflow guide](hospital-stock-disposal.md). Pending proposals do not change quantities. Approval changes quarantine only; no patient charge, supplier transaction or journal is generated.

## Live verification

The unique deployment's Hospital page, stylesheet and three changed Hospital scripts match the tested source. Live checks use existing demo accounts and read-only business operations; disposal and financial mutations are forbidden by the verification script.

The before-deployment baseline contains the bounded 28 October–4 November demonstration period: one purchase and three visits, with no receipts, returns, supplier bills/payments/remittances, patient charges/invoices or stock counts in that period. The sampled 1 October–31 December expiry range is empty. This is a bounded preservation check, not an all-time database export.

Final canonical-site checks passed: the baseline matched exactly and the verification recorded zero business-write requests. Super Admin and Pharmacist could read stock disposals; Hospital Cashier and Nurse were denied. Unauthenticated requests returned 401; wrong-branch requests and missing/oversized history periods were rejected. Opening the task requested one pending page and no dated register. Reopening, repeated dated loads and print previews reused loaded data; explicit refresh queried once. Eight 390px/1366px role screenshots passed without page errors or horizontal overflow. The five changed assets match the tested source on both canonical and unique deployment URLs; admin/service-worker release markers agree.

Local evidence is retained under `tmp/hospital-disposal-live/`: the immutable baseline, `verification.json`, `unique-deployment-assets.json` and screenshots. The [GitHub development-check run](https://github.com/Jozcefhs/portal/actions/runs/41879373328) was still queued for a runner at handoff; its completion is not claimed. The local full suite and live checks above completed successfully.

No desktop executable or installer was compiled or released. Patient cards remain NFC and card-terminal payments remain disabled.
