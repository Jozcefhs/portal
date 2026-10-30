# Requisition attachment viewing

Finance Requests & Imprest exposes **View attachment** and **Download attachment** directly beside every loaded requisition that has a supporting document. The same controls appear in the requisition preview. Expense and material requisitions keep these controls after approval, posting/payment, rejection or cancellation, regardless of edit permission. Saved supplier-bill attachments use the same mechanism.

Viewing matches the record's existing branch, section and role/department visibility, including Directors, Admins and authorised final approvers. It does not confer editing, approval or payment rights. The protected endpoint resolves the stored file from the authorized record; callers cannot supply a storage URL. Files remain private and require a current staff session.

No attachment is fetched when a list or preview is rendered. A deliberate View or Download action performs one record lookup and one stored-file read, in addition to the normal staff-session checks. No request or financial record is written. The print preview stays open until Print is chosen, and a file opened there displays in that same window. Preview object URLs are released on close/navigation. Attachment controls are omitted from paper printing.

The shared web code applies across editions. This pass targets the DCA deployment, with no desktop compilation or installer release.

Validation: all 4,487 repository tests passed, including the payroll suite. Permission parity tests cover read-only staff, approval officers, status changes and branch/section isolation in all four editions. Endpoint tests exercise authenticated streaming, download disposition, denied access, bounded reads and record preservation. The isolated browser check covers list and print-window previews/downloads, absent attachments, permission errors, mobile controls and no file reads during rendering.

Live verification on 30 October 2026: source `152b8a9ec69fd53eaad3da8cf1157fbbfea5529e` was pushed and deployed as DCA deployment `d4744bea`. All five checked public assets matched the tested source. In the signed-in staff session, an existing supporting image opened successfully from the request list and again within its requisition preview, without entering the edit form. No financial data was changed. A final preview cleanup replaces the temporary loading page before rendering the document; the browser regression check and 22 relevant tests passed again with that cleanup.
