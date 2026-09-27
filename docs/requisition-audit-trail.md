# Requisition edit and security audit trails

Applies to School, Church/Faith and Other Organisation editions.

- Requisition edits now preserve the authenticated officer's display name, username, assigned role, timestamp, action, revision number and changed business-field names. Approval passwords and proofs are never part of the edit event.
- Web edit/resubmit and desktop edits archive the prior record and commit the edited record plus audit event together, with database-version preconditions. A stale desktop edit from the updated client is rejected instead of overwriting another officer's changes.
- View / Print Requisition includes an **Edit and resubmission history** table, separate from approval and rejection endorsements. Later decisions do not replace the earlier editor's identity.
- Older resubmissions show their already-recorded editor/time. Missing historical changed fields are labelled as not recorded; an ordinary `UpdatedBy` value is not treated as proof of an edit.
- The aggregated Security Audit view expands generic actions using the recorded entity/module, retains `OriginalAction`, and recognizes both `RecordId`/`EntityId` and `User`/`UserName` formats. Request-level entries include the requested status/decision, known reference, route and outcome. Request audit success means the HTTP request succeeded; the accounting audit records the committed business event.
- Desktop request audit identity comes from the server-authorized actor. Unauthenticated account claims are labelled unverified, not presented as verified officers. Query tokens, passwords and full request payloads are not copied to audit records.

Deploy the portal backend/UI and distribute an updated desktop build to expose the native print-table and stale-editor guard. Existing installed desktop executables do not change when source is pushed.
