# Teacher and assistant initial classroom allocation

Web companion: **Academic Management → My students & subjects → Allocate pupils / Allocate students**.

Class teachers and assistant class teachers can select existing unassigned learners from their class and allocate them to their assigned arm. Assignment authority is checked against the current branch, school section, academic session and term. A subject-teacher allocation by itself does not grant placement authority. Staff keep their existing read-only and subject-selection access.

This is a separate `canAllocateClassStudents` capability. It does not grant transfer/reassignment, CSV imports, generic membership edits, teacher allocation, archive or delete permissions. Existing administrative allocation rights are retained. New teacher authority is confined to the authenticated web route.

Candidate profiles are returned separately from the normal teacher roster, contain only identification fields needed by the selector, and exclude assigned, inactive, conflicting and history-only memberships. Opening navigation fetches selectors and assignments; candidates load only when records are requested. Allocation reads the selected branch/section and period, never score or movement history. The server checks classroom authority before reading learner records for a mutation.

The existing atomic placement workflow preserves scores and earlier history, reuses legacy membership IDs and guards pupil/profile revisions. The teacher assignment revision is also checked in the commit so a concurrent revocation prevents the placement. Retries skip exact existing allocations without writing additional memberships, movement history or academic audit records. Client-supplied subject, status and identity overrides are discarded for teachers.

Validation: behavioural tests cover both class-teacher assignment roles, branch/section/period boundaries, forbidden administrative actions, subject-only assignments, mixed invalid batches, concurrent assignment revocation, record preservation, repeated requests and selective candidate visibility. Browser checks cover the actual allocation form and selector logic for both roles at desktop and mobile widths, using synthetic pupils only.
