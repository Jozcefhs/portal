# Parent School Store

The parent dashboard School Store uses a responsive product-card catalog instead of a long list of individual rows. This is shared by all editions using the parent web/PWA dashboard; it does not change staff POS layouts.

- Products have image-free, coloured cards: blue for books/supplies and warm neutral for clothing/supplies.
- Search, shop/category filters and name/price sorting operate on the selected child's existing authorized catalog. Twelve products appear per page. Changing filters or children resets pagination.
- The heading, Cart shortcut, search and filters stay together in a sticky bar while scrolling the store. Its measured height keeps cart/page scroll targets visible; on wider screens it sits below the top dashboard navigation, and on phones the bottom navigation is unchanged. Hidden panels and resized/rotated screens are remeasured without reading or changing any account data.
- The cart stays beside the catalog on larger screens. On screens up to 900px it moves above the products and starts collapsed; the Cart shortcut opens it. Phones show two product columns.
- Cart items persist when filtering, sorting or changing catalog pages. Switching children retains the dashboard's existing cart-clearing behavior.
- Quantity dropdowns list every whole number from 1 through the available stock (for example, 1–500 when 500 units are available). Sold-out items show a disabled zero quantity. The compact controls retain the native mobile picker and a visible dropdown arrow. Added items remain locked until removed from the cart, preventing duplicate clicks; their selected quantities survive filtering and pagination.
- Order and collection history stays available in a collapsed section below the catalog.

This is a presentation-only change. Prices, branch/section eligibility, fee-included collection records, order creation, payment verification, and checkout authorization/idempotency remain on the existing backend. The service worker precaches the new scoped stylesheet.

Regression coverage is in `tests/parent-storefront.test.mjs`, alongside existing parent-store eligibility and mobile-interface tests. Visual checks use synthetic products and no payment service.

## Payment reference identity

New parent store, fee and wallet payments use the shared server-side reference-code resolver. An explicit school-code override for the authenticated account's branch takes priority; otherwise the canonical organisation code is used, with legacy school settings, deployment configuration and finally the neutral `ORG` prefix as fallbacks. A stale legacy school code must not override a saved organisation code. There is no default specific to any school.

The same reference is passed to Paystack or the direct-transfer workflow and stored in the payment intent. Existing references, completed receipts and idempotent checkout replays retain their original identifiers for verification and reconciliation. Changing the code does not rename previous transactions. Regression coverage is in `tests/store-payment-reference.test.mjs` and `tests/school-code-default.test.mjs`.
