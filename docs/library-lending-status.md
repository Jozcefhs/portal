# Library reservations and returns

Reservations are title-level waiting-list entries. They do not issue a physical copy. An available copy with a pending reservation displays **Reserved**; a genuinely issued copy displays **On Loan**, with its reservation queue shown separately. Checkout honours the first pending reservation.

Web and desktop show **Loans & returns**, with a **Record a return** shortcut and a catalogue return action for matching active loans. Closed loans remain in return history. Normal return makes the physical copy available and preserves pending reservations. Damaged/lost outcomes remain unavailable.

The shared backend resolves older branchless main-branch loans only through a same-copy checkout pointer. It does not expose cross-branch linked loans. Copies with missing, duplicate or conflicting active loans display **Status needs review** rather than silently becoming available.

An authorised library officer may explicitly repair a stale On Loan status after confirming that no borrower holds the copy and recording a reason. The backend checks the linked loan and all loans referencing the copy, refuses an active/conflicting/lost/damaged loan, applies a copy-version precondition and records an immutable audit event. The previous checkout reference is retained. Reservations and loan history are not deleted.

Borrower counters and reservation records are looked up by their indexed logical IDs, then scoped to the branch. This avoids failed document lookups for batch-written IDs containing admission-number escapes. Existing document IDs and version preconditions are preserved on updates.

Regression tests exercise reservations, queue priority, checkout/return, encoded IDs, borrowing limits, legacy links, branch isolation, explicit stale-status correction, permissions, read-only subscriptions and lost/damaged outcomes. Desktop tests cover return shortcuts, cancellation, stale/closed-loan guards and tab navigation.
