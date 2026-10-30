# Hospital supplier remittances — verified 30 October 2026

- Pushed source: `d11171e9d7df04cdd8969273241b8af6f244fccf`, branch `codex/hospital-edition`.
- Isolated deployment: https://7a83c684.dynamax-hospital-review.pages.dev
- Owner demo: https://dynamax-hospital-review.pages.dev/hospital.html?task=procurement
- [GitHub Hospital checks passed](https://github.com/Jozcefhs/portal/actions/runs/41026981328).
- Both additive `hospitalSupplierRemittances` indexes are READY in `dynamax-hospital-review`.

The repository run passed 4,594 tests. Two further remittance boundary tests passed, bringing the tested set to 4,596 cases; the final Hospital/shared subset passed 325 tests. Thirteen remittance scenarios cover 20-invoice settlement, partial payments, one journal/audit/balance update, lost responses, reference reuse across individual/batch payments and branches, concurrent payments, permission boundaries, stale/invalid allocations, accounting controls and immutable reversals.

The browser workflow exercised real service functions against synthetic in-memory records: procurement, receipt, invoice approval, individual payment and multi-invoice remittance. It verified mobile allocation inputs fit the viewport, preview/print requires no reads, retained details avoid repeat reads, and branch changes clear records and selections. No financial test records were written to the live demo.

Live checks confirmed Super Admin can view financial registers without cashier payment authority; Hospital Cashier can record remittances; Pharmacist cannot access financial registers or payment controls. All three views opened without automatic procurement history requests and passed desktop/mobile checks. Repeating a dated register load reused its retained page. Deployed HTML, stylesheet and procurement script matched the committed source; the staff portal and service worker release markers matched.

Before/after snapshots for 28–30 October showed the existing demonstration purchase and three reception visits unchanged. Receipt, supplier bill and supplier payment registers remained empty. No migration or deletion ran. No school, faith or other organisation deployment was changed. Card terminals remain disabled, and no desktop application or installer was compiled or released.

Local verification artefacts: `tmp/hospital-remittance-live/verification.json`, `tmp/hospital-procurement-ui/`, `tmp/hospital-remittance-final-tests.txt`. These artefacts and private demo credentials are not part of the public web deployment.
