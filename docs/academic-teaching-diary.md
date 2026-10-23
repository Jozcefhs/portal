# Teaching diaries and inspector printouts

Delivery: the class/arm correction is deployed on the web. Desktop packaging is authorised for v3.1.45; the public update feed changes only after the installer is uploaded and verified.

The class-wide diary change is corrected: weekly records and schemes are once again keyed by class **and arm**. Selecting a classroom shows only its subjects and permissions. The original arm-based record IDs, saved work, approval states, history and payment targets are reused without migration. A form teacher can compile only the assigned arm's diary.

Records saved during the class-wide version remain untouched and are not copied into each arm. Academic Management can inspect and print them through **Earlier class-wide records (read-only)**. Existing pending payments still target the original reserved record, never a different arm. Old class-only clients must refresh/update and select an arm before loading or saving.

In Academic Management, select the school section, session and term, then open **Teaching diaries**.

1. Select a class **and arm**, week, then load. Select a subject and load again.
2. The allocated subject teacher prepares that term's scheme of work (week, theme/topic, content). Select the other terms in Academic Management to prepare the full session.
3. Each allocated subject teacher saves and submits their own weekly work, including the common week-ending date. If a lesson was not held, explain that in the work-completed field rather than reporting it as completed.
4. The assigned Form Teacher compiles and submits when all offered subjects are submitted. Assistant teachers do not automatically gain compiler authority.
5. Academic reviewers approve, or return with a reason. Submitted entries lock; returning preserves previous versions in immutable history. Concurrent edits require reload instead of silently overwriting another teacher.

## Inspector copies

- **Preview / print weekly diary** includes every subject, planned/completed work, notes, compiler, reviewer and approval status.
- **Preview / print session scheme** includes the selected subject across the session's terms.
- The class attendance term-report action includes summary totals **and dated registers**, filtered to the selected class/arm, session, term and register type.
- Desktop opens a saved HTML preview; web opens a browser preview. Use **Print / Save as PDF**. Printouts repeat table headers on subsequent pages and escape all user-entered text.
- Previews use saved records, not unsaved text. Unapproved diaries are marked **STAFF PREVIEW — NOT YET APPROVED**. Attendance uses posted records; pending corrections are not treated as approved changes.
- Keep inspector exports secure: they contain student/staff information.

Submission deadlines, per-record surcharges and verified Paystack automatic submission are now implemented separately and default to disabled. See [Academic submission deadlines](academic-submission-deadlines.md) for setup, supported records and release requirements.

## Verification

Web: `node --test tests/academic-diary.test.mjs tests/academic-attendance-print.test.mjs tests/academic-serial-search.test.mjs`.

Desktop: `python -m unittest tests.test_academic_diary tests.test_academic_management tests.test_academic_weighted_results`.

`tests/fixtures/academic-diary.html` is a read-only browser fixture using synthetic records only.
