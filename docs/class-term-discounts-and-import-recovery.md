# Class and term discounts, and pupil profile recovery

Total school-fee discounts support multiple non-overlapping rates per branch and billing category. Each rate selects classes and terms and can use a percentage, fixed amount, or explicit None. A matching rate replaces the category default. Existing category defaults retain their coverage. Term names apply every academic session until edited.

Catalogue options load only when the editor opens. Editing selections does not fetch records. Concurrent edits use revision checks and repeated unchanged saves do not write another record or audit entry. Existing posted invoices retain their recorded amounts. The desktop source includes the editor, and installed desktops require a later installer to expose it.

Academic CSV import can recover a missing pupil profile when the same branch, section, session, term and admission number already have an active membership. It retains the saved classroom and subject choices. Explicit conflicting changes direct the user to the existing transfer or subject workflow. Recovery creates the missing profile with a create-if-absent guard and checks the existing membership revision. Repeating the import performs no writes or extra movement history.

Verification on 10 November 2026 included 4,809 web tests, the prior 1,160 desktop tests, 25 final desktop layout and discount checks, and browser coverage at desktop and mobile widths. A targeted five-pupil Area 1 recovery was simulated, checked for zero retry writes, applied atomically and verified. The private recovery evidence remains outside version control.
