# Hospital pharmacy stock control verification

Verified on 30 October 2026. This increment is deployed only to the isolated Hospital Owner's Demo; the wider Hospital roadmap remains open.

- Source commit: `344aa88cac263ce17969d20fdd634ac393a36ae0` on `codex/hospital-edition`.
- Deployment: `4f2d96f8`, [Hospital Owner's Demo](https://dynamax-hospital-review.pages.dev/hospital.html?task=stock-control).
- Web marker: `dynamax-v526-hospital-stock-control`; the admin page and service worker agree.
- Four additive Firestore indexes are READY in `dynamax-hospital-review`: batch expiry, counts by date, counts by status/date, and count history by date. No indexes or records were deleted.

## Automated verification

All 4,612 repository tests and 13 distinct Hospital browser workflows passed. The 16 stock-control service cases cover concurrent submissions/reviews, duplicate permanent references, lost responses, unchanged retries, permissions, branch/module isolation, invalid quantities/times, preserved snapshots, dispensing during a pending count, stale approval rejection and backup coverage. A matching count records verification without a zero-quantity stock movement. Discrepancy approval produces one conditional stock adjustment; no patient charge, supplier payment or journal is generated.

The browser checks cover failed-submission form retention, cached pages, date-first loading, preview/print without queries, independent approval, retained history and desktop/phone layouts. The [Hospital development checks run](https://github.com/Jozcefhs/portal/actions/runs/41039692371) passed for the deployed source commit.

## Live checks

The existing demo accounts were used for read-only business checks:

| Role | View stock controls | Record counts | Review counts |
| --- | --- | --- | --- |
| Super Admin | Yes | No | Yes |
| Pharmacist | Yes | Yes | Yes, another officer's count |
| Hospital Cashier | No | No | No |
| Nurse | No | No | No |

Unauthenticated access was rejected with HTTP 401. Missing dates were rejected. Date/status count queries and the expiry query completed successfully. Opening the page requested no stock registers; repeating a loaded count range used the browser cache. Both 1366px and 390px layouts were inspected, with no page overflow or browser errors.

The deployed HTML, stylesheet and Hospital scripts match the committed assets. Before/after snapshots matched for the bounded demo period: one purchase, three visits, and no receipts, supplier bills or supplier payments. No live stock counts, adjustments, patient changes or financial transactions were submitted by these checks. Sign-ins used normal authentication/session handling.

No desktop executable or installer was compiled or released. Deployment packaged the web assets and Pages Functions only. Card terminal payments remain disabled. Physical NFC-reader validation and the remaining Hospital roadmap are separate work.
