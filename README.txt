DCA Admissions Portal - v2.8.0


Files included:
1. verify.html and js/verify.js
   - Parent verifies using the email address and verification code sent after payment.

2. application.html and js/application.js
   - Completed admission form submission.

3. upload-documents.html and js/upload-documents.js
   - Parent self-service upload page for one or many missing documents.
   - Parents can select several files and upload them in one visit.
   - Existing uploads are not silently replaced; parents must tick the replace option.
   - Linked from index.html and success.html.

4. payments.html, payment-success.html, js/payments.js, and js/payment-success.js
   - Parent can pay configured online fees, including Acceptance Fee.
   - Paystack checkout is initialized from Cloudflare, not from browser JavaScript.
   - Payment is recorded only after Paystack verification succeeds.

5. functions/api/verify.js
   - Cloudflare Pages Function for verification.

6. functions/api/submit-application.js
   - Cloudflare Pages Function for application submission.

7. functions/api/upload-document.js
   - Cloudflare Pages Function for document upload.

8. functions/api/payment-options.js, functions/api/init-payment.js, and functions/api/verify-payment.js
   - Cloudflare Pages Functions for online fee lookup, Paystack initialization, and payment verification.

Required Cloudflare environment variables:
- GOOGLE_APPS_SCRIPT_URL
- GOOGLE_APPS_SCRIPT_SECRET
- PAYSTACK_SECRET_KEY

Backend requirement:
- Deploy DCA_Admission_Backend_v2_8_0_Unified.gs from the Admissions Suite docs folder.
- In Apps Script, enable Project Settings > Show "appsscript.json" manifest file, then copy docs/appsscript.json from the Admissions Suite docs folder into the manifest.
- Redeploy the Web App and approve the requested Google Drive permission. Parent document upload stores files in Drive.
- The backend must include uploadParentDocument, updateApplicantIntelligence, getPayableFees, recordOnlinePayment, and accounts ledger actions.
- Organisation editions use `settings/organisationProfile`; missing configuration defaults to the school edition. See `../suite/docs/ORGANISATION_EDITIONS.md` for the church foundation and feature boundaries.
- In the FeeItems sheet, set the Acceptance Fee amount before parents start paying online. The default amount is 0 until updated.

After replacing website files:
- Commit and push to GitHub.
- Wait for Cloudflare Pages deployment to complete.
- Test with a fresh unused verification code.

Expected behavior:
- Verification code is not used up during verification.
- Code is marked Used=YES only after successful application submission.
- Duplicate submissions are blocked by VerificationCode, not by email.
- Parent receives confirmation email.
- Admissions team receives notification email.
- Applicant sees success page with application reference.
- Parent can later upload missing documents using verification email/code.
- Reuploads are blocked unless the parent explicitly chooses to replace existing documents.
- If uploads return DRIVE_AUTHORIZATION_REQUIRED, the Apps Script Web App has not been redeployed/authorized with Drive access.
- Parent can pay online fees through Paystack.
- Verified online Acceptance Fee payments automatically mark AcceptanceFeePaid=YES and appear in the Accounts ledger.
- Wallet topups and wallet spends are accounted for:
  - Topups create wallet-credit (liability) ledger entries as before.
  - Wallet purchases now create a posted accounting journal (`SYS-WALLET-PURCHASE-*`) that debits `2200` (Student Wallet Liability), so the finance liability card reflects spend immediately.
  - Purchase credit account defaults to store/revenue mapping (`4040` for store-like context, otherwise the mapped revenue account).
- Finance surplus behavior:
  - Gross Surplus = Net Revenue - Direct Costs.
  - Net Surplus = Total Income - Total Expenses (includes Other Income).
  - Therefore Net Surplus may be higher than Gross Surplus when there is positive Other Income.
