# Class teacher score review (web companion)

Open **Academic Area → Scorebook → My classroom scores**. Select the school section, session and term, choose your assigned classroom, then click **Load classroom scores**.

- The register shows the classroom's current students and marks across their offered subjects, including marks entered by other subject teachers and Draft scores. It is a vetting view, not a published report or a parent-access route.
- Filter by subject, test, student or score condition. Missing, absent, exempt and not-enrolled cells keep their meaning; a saved zero remains zero.
- **Preview / print** includes every matching student, including later pages. It repeats student identity across manageable groups of score columns and supports printing or saving as PDF.
- Switching back to a loaded classroom restores its filters and page for up to ten minutes. Use **Refresh classroom scores** to fetch newer marks. Preview, printing, searching, filtering and pagination use the loaded snapshot.

Access requires an active **Form Teacher** assignment for that exact classroom, session and term. A subject-teacher allocation alone does not grant classroom-wide access. Configure assignments under **Assign class teachers**. Branch and school-section restrictions still apply. The feature adds no score editing, approval or publication permissions and is available only through the web companion.

Opening the register reads selectors and the teacher's assignments only. Loading a classroom queries that classroom's memberships, then score records for those students in the selected class and term. Saved marks from an earlier arm and class-wide subject sheets remain visible for those students. Sheet definitions and student names are resolved by referenced IDs, with the existing scoped legacy-name fallback. This workflow does not modify student records, marks, score sheets, results or audit history.

Validation: `node --test tests/academic-classroom-score-register.test.mjs tests/academic-scorebook-opening.test.mjs`, plus `node tests/academic-classroom-register-browser.mjs` with Playwright available. The existing class-register browser test also checks the shared administrator interface.
