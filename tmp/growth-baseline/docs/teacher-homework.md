# Teacher homework and parent messages

Available in both **Primary and Secondary**, through **Academic Management → Homework / parent message**.

1. Choose the working branch and school section in Academic Management.
2. Open **Homework / parent message** and choose a class and subject.
3. Tick one or more assigned arms. Enter a title, instructions and optional due date.
4. Select **Preview audience & message**. Check the student/parent counts and any missing-email warning.
5. Select **Send to selected parents**.

## Assignment requirements

Management must activate the academic session and term, class, arms, subject offering and the teacher's **Subject Teacher** allocation. An arm-specific allocation grants only that arm; a class-wide subject allocation grants the active arms offering that subject. Form-teacher responsibility alone does not grant subject-homework authority.

Recipients are derived server-side from active memberships for the exact branch, section, session, term, class, selected arms and subject. Inactive or withdrawn profiles are excluded. The section-scoped student profile takes precedence over a duplicate legacy profile. The parent portal's canonical email identity is used, not arbitrary addresses entered by a teacher. Duplicate parents receive one notification per message.

## Delivery and safety

- The message is available through existing parent notifications, subject to organisation notification settings. Browser/phone push requires a subscribed device, notification permission and enabled parent preferences.
- Push is queued through the existing durable notification delivery scheduler. Delivery is not guaranteed to be immediate; workload and the scheduler affect timing.
- Full instructions remain in-app. Long Unicode text is shortened only in the push preview, with a prompt to open the parent portal.
- Preview and send each recheck current allocations and recipients. If the audience changes, a fresh preview is required. Opening the composer can reuse a session-scoped context snapshot; **Refresh** reloads it.
- A repeated request or concurrent retry creates only one homework, notification and push job. After a network error, use **Retry / check this same send**; do not compose a second copy while the first result is uncertain.
- Teachers see counts, not parent email lists. Existing academic access and subscription restrictions apply. No separate plan entitlement has been added.

## Before rollout

Run the repository test suite and compile Pages Functions. Deploy the school index definitions, including the teacher-allocation and student-membership homework queries, and wait for the indexes to be ready. Verify the existing notification scheduler, parent notification indexes and tenant FCM configuration in the target deployment. Test with an authorised test parent device before relying on push for time-critical homework. Do not send a real class message as a deployment smoke test.
