# Wallet card registration

Wallet setup is shared across School, Church and Other Organisation editions. It registers a card; it does not create a payment, change a wallet balance or approve a purchase.

- Desktop Accounts uses the selected student's exact account and student scope. Changing the account-register selection reloads an open Wallet Setup dialog; a student without a card starts with a blank card field. Their status, spending limits and PIN draft are refreshed together. Reopening the same student preserves an unsaved draft.
- The desktop account reference is read-only so editing it cannot assign another student's card and spending controls to an unrelated record.
- Web lookup accepts an admission number or existing card. Editing either clears the other identifier and discards the previous student's assignment form. Failed lookups do not leave that old form available. Delayed responses from a replaced branch/session workspace are ignored.
- Card registration does not ask for a second staff password. Desktop finance-edit roles and authenticated web Accounts permissions remain required and are checked when saving. Wallet purchase PINs, payment approvals, server-side branch/section scope and duplicate-card validation are unchanged.

Regression checks use synthetic students and mocked persistence only. No real cards, payments or balances are changed by the tests or by installing the repair.
