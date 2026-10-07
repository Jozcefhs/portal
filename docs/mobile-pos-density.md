# Compact mobile sales workspaces

The shared staff stylesheet keeps Tuck Shop, Organisation Store and Restaurant
catalogues compact across School, Church and Other Organisation deployments.
No stock, receipt, wallet or payment logic is changed.

- Mobile cards no longer reserve a second name line when it is not needed.
  Names can still wrap to two lines; price, stock, category/unit and labelled
  quantity/add controls are retained. Add buttons have a 32px target.
- Cards use subtle blue, green and warm backgrounds, with dark-theme variants.
  Added-to-cart highlighting remains distinct.
- Phones have two columns; wider mobile views from 520px have three.
  The catalogue scrolls within a viewport-bounded height.
- Only the redundant empty-cart message is hidden on mobile. Empty inventory
  warnings, real cart lines, totals and checkout safeguards remain visible.
- The sales page also reduces spacing in the module summaries, header, tabs,
  search, customer lookup, payment forms, receipts and recent-sale history.
  Manual lookup remains expandable and recent sales remain collapsible.
- The admin stylesheet URL is versioned so a refresh loads the new layout.

## Verification

Browser checks used the actual POS render functions and shared stylesheet with
synthetic inventory, without API calls or transactions. Checked 320, 390, 430,
600 and 1280px viewports, empty/filled carts, long names, light/dark themes,
student-wallet and staff-payment forms, and organisation checkout.

At 390px the first card decreased from approximately 114px to 91px and six
complete cards fit in the catalogue instead of four. The unresolved-customer
cart section decreased from approximately 530px to 350px. No horizontal page
overflow was observed at the checked widths. Regression tests are in
`tests/tuck-shop-mobile-layout.test.mjs`.
