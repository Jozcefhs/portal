# Local CBT answer review

The desktop source now uploads saved answers after approved score uploads for linked Online CBT papers. Each CBT server signs copies with the same key used for its accepted score batch. A failed answer upload does not reset the score receipt.

Previously uploaded scores can be backfilled using **Local CBT Server → Mark / Review → Upload saved answers** on the original server. This operation does not mark, approve or resubmit scores. Existing installed executables need the desktop update before this button and automatic answer upload are available. No installer was compiled or released in this pass.

In the web companion, use **Academic Area → Online CBT → Answers / print → Load answers → Preview / print answers**. Remote exam answers remain available through a separate link. A missing local copy is reported explicitly; score totals cannot reconstruct student selections.

Copies contain the original question/option identifiers, correct options, saved student answers and marks. They are immutable, branch/section/workspace scoped and restricted to academic reviewers. Each copy holds at most 10 students and 200 questions, within a bounded request size. Existing copies, score sheets, receipts and local attempts are never replaced. A completed local acknowledgement prevents repeated uploads; a lost response can safely retry the same create-only document.

The list requests metadata in pages of 50 copies. Full answers are fetched only for the selected student and reused for repeated preview/printing during that page visit. No polling, whole-school answer scan or per-preview audit write is introduced.

Validation: unit tests cover signature/receipt checks, scope permissions, altered marks, rejected students, concurrent retry and record preservation. Browser checks cover saved option comparison, printing, mobile layout and cached reopening. `scripts/verify-local-cbt-answer-wire.mjs` verifies an actual Python store/signature against the JavaScript upload service using temporary fixture records only.
