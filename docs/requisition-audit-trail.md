# Requisition edit and security audit trails

Applies to School, Church/Faith and Other Organisation editions.

## Super Admin-controlled edit permission

Open **Staff & Permissions → Manage Staff Account → Allow this officer to edit and resubmit requisitions**, then save.

- This is an individual officer grant, not a role-wide grant. Approval permission alone does not confer edit permission.
- Accounts Officer, Admin, Management and staff with explicit finance approval authority are eligible. Super Admin and Director retain their existing administrator-equivalent access.
- Other officers start without edit access. Revoking the grant takes effect on the next authenticated request; refresh the finance workspace to update buttons. Client-supplied permission flags cannot override the stored grant.
- Grants and revocations are logged in the security audit. The officer keeps the existing branch, department and school-section restrictions.
- Editing a submitted or reviewed requisition uses the common edit/resubmit transaction: earlier endorsements are cleared, the prior revision is archived, and approval restarts at Accounts. Final-approved, paid, posted and cancelled records remain locked. Approval/status actions cannot silently alter requisition contents.
- An Admin edit is not an Admin review of the new revision. After resubmission, Accounts must confirm and Admin must select **Review** before Director / Super Admin sees **Approve**. The register shows the pending office and explains why Director approval is not yet available; it never skips a stage or reuses an earlier revision's approval.
- A requester may still prepare their own desktop draft without delegated edit access. Native desktop uses **Edit / Resubmit Selected**; material item quantities/prices are edited through the existing web material editor.

## Recorded history

- Material edits name the actual changed columns: Item, Specification, Quantity and Unit price. The grand-total Amount remains a separate field; recomputed line totals do not create a misleading "Material items" entry. Numeric formatting and line numbering are not edits.
- On View / Print, older "Material items" entries are clarified from matching saved before/after revision snapshots where available. This read-only display correction preserves officer names, timestamps and stored audit records. If snapshots are missing or cannot be verified, the original description is retained rather than guessed.

- Requisition edits now preserve the authenticated officer's display name, username, assigned role, timestamp, action, revision number and changed business-field names. Approval passwords and proofs are never part of the edit event.
- Web edit/resubmit and desktop edits archive the prior record and commit the edited record plus audit event together, with database-version preconditions. A stale desktop edit from the updated client is rejected instead of overwriting another officer's changes.
- View / Print Requisition includes an **Edit and resubmission history** table, separate from approval and rejection endorsements. Later decisions do not replace the earlier editor's identity.
- Older resubmissions show their already-recorded editor/time. Missing historical changed fields are labelled as not recorded; an ordinary `UpdatedBy` value is not treated as proof of an edit.
- The aggregated Security Audit view expands generic actions using the recorded entity/module, retains `OriginalAction`, and recognizes both `RecordId`/`EntityId` and `User`/`UserName` formats. Request-level entries include the requested status/decision, known reference, route and outcome. Request audit success means the HTTP request succeeded; the accounting audit records the committed business event.
- Desktop request audit identity comes from the server-authorized actor. Unauthenticated account claims are labelled unverified, not presented as verified officers. Query tokens, passwords and full request payloads are not copied to audit records.

Deploy the portal backend/UI and distribute an updated desktop build to expose the native print-table and stale-editor guard. Existing installed desktop executables do not change when source is pushed.
