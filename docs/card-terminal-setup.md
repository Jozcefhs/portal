# Paystack physical terminal preparation

Available in school, faith and organisation editions. Web: **Income Analytics → Card terminal**. Desktop: **Finance & Accounting → Card terminal**.

The initial workflow collects **general income** against an existing revenue account. It does not allocate student invoices, top up wallets, fulfil store orders or settle hotel bills. Those remain on their dedicated payment screens so money cannot be counted twice or balances left incorrect.

## Before hardware arrives

Keep terminal payments disabled. No card reader purchase, merchant activation or live payment is part of this preparation. Software tests simulate provider responses; they do not certify a physical terminal. Ordinary USB card readers cannot process Paystack payments.

This release keeps the server deployment gate off. Enabling a branch, creating a payment request and sending a charge are blocked, including direct API requests. The web and desktop enable controls are disabled. Activation later requires explicit operations approval and `CARD_TERMINAL_PAYMENTS_ENABLED=true` on the relevant deployment after hardware acceptance; branch settings alone cannot activate payments. Existing payment verification remains available.

## Setup after delivery

1. Obtain and activate a Paystack physical terminal on the organisation's Paystack merchant account.
2. Select the working branch and open Card terminal → Terminal setup.
3. Enter its Paystack terminal ID and a cashier-friendly label. Each enabled terminal belongs to one branch.
4. If the branch uses a Paystack subaccount, create the intended split in Paystack and enter its numeric split ID. The setup checks that it includes the branch subaccount. Review the split's percentages in Paystack.
5. An administrator enables the terminal. This verifies the device belongs to the configured Paystack connection and matches its test/live mode.
6. Keep the existing `/api/paystack-webhook` URL configured in the Paystack dashboard. No new secret is entered on desktop or in the browser.
7. With the terminal connected, conduct one authorised small live payment and reconcile its receipt, ledger entry, Paystack fee and settlement before wider rollout. Card-network acceptance and cancellation behaviour require the real device.

## Collecting payment

Choose an income account, payer name/email, amount in NGN and description. Create a request, then send it to the terminal. The payer uses the terminal for card insertion/tapping and PIN entry. Dynamax does not request or store card numbers, PINs or CVVs, and does not send invoice emails.

“Sent to terminal” is pending. A receipt becomes available only after the backend fetches the original Paystack invoice and verifies its linked successful transaction, payer, amount, currency and environment. Receipt, journal and accounting audit are committed atomically. Concurrent checks and webhooks reuse that result. Test-mode payments never post live accounting entries.

Use **Check payment** to reconcile a pending request. A completed request does not create another payment or revenue entry when checked again. Fees post to Bank and Payment Charges; the net amount posts to Online Payment Clearing. Settlement reconciliation remains the existing accounting process.

## Interrupted operations

Resume the displayed `TERM-…` reference. The UI saves only that reference locally. Closing the window does not cancel a request at Paystack.

If invoice creation had an unknown outcome, the backend will not create another invoice on retry. Copy the original `PRQ_…` code from Paystack into **Recover original invoice**; recovery verifies it belongs to the saved request. If creation stopped before a customer was saved, the screen explains that no invoice could have been requested. Check the merchant dashboard before charging again.

If payment succeeded but the accounting period is closed, the request remains unposted and recoverable; Accounts must review the period before retrying verification. Do not charge the payer again.

History is requested only for selected dates (up to 31 days, WAT), in pages of 100 payments. Use **Load more** for older payments in the selected range. Switching a terminal's branch requires disabling it in its old branch first; existing payments can still be verified after disabling.

## Provider references

- https://paystack.com/docs/terminal/push-payment-requests/
- https://paystack.com/docs/api/terminal/
- https://paystack.com/docs/api/payment-request/

Hardware acceptance still required: actual invoice transaction shape, delivery, disconnect/resume, cancellation, verified fee availability, receipt printing, live settlement and the supported card networks.
