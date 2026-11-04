# Dynamax 3.1.62

- Branch-specific class, admission and fee choices now follow the selected branch. Setup and billing-category actions remain visible at smaller window sizes and higher display scaling.
- Student fee lookup can verify configured charges from selected classifications without selecting a student. Total school-fee percentage and fixed discounts are easier to find.
- Local CBT servers upload signed saved answer copies alongside scores, with independent retry tracking. Uploaded answers can be reviewed and printed on the web companion. Existing saved scores and answers are preserved; retries do not create duplicate copies.
- Local CBT includes printable comparisons of a student's selections and the teacher's answers.
- Desktop personal parent setup links are scoped to the learner and branch.
- Existing records, payments and local CBT databases are preserved. Card terminal payments remain disabled.

Update each Windows computer, including every local CBT server, to v3.1.62. Close Dynamax between examinations before installing. To make earlier local test answers available online, use the original CBT server to push its saved results again after updating; do not delete or recreate the test.

Installer SHA-256: `95b3a2a58266e18b2514f2061798e69f855ad5866cb7bc08de5cfb366af8d729`

Validation: clean packaged build, bundled CBT/Android and TLS checks, and frozen application self-test passed. The desktop regression suite ran 1,135 tests; the loopback and UI checks blocked by the restricted test environment passed in an unrestricted rerun of all 122 tests in the affected modules.
