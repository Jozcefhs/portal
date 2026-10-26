# Entrance and remote examinations

## Where to start

In the web companion, open **Applications → Entrance examinations**, or **Academic Management → Entrance / remote exams**. The selected school, branch and school section apply. School management, ICT and authorized admissions/examination staff can manage admission exams; enrolled-student exams require academic review permission.

Choose **Admission applicants** or **Enrolled students — remote tests**. Each school configures its entrance subjects and maximum marks in **School setup → Entrance examination subjects**. There is no fixed three-subject requirement.

## Reuse a test already uploaded for Local CBT

1. Choose **Enrolled students — remote tests → Use uploaded CBT test**.
2. Select the academic session, term and class, then **Load uploaded tests**. Returning to a loaded selection reuses its list; **Refresh uploaded tests** checks for newer uploads.
3. Click **Use for remote test** beside the paper. For a split test, choose Objective or Theory; each has its own remote sitting and scorebook part.
4. Set the remote opening/closing window and duration, then **Save remote draft**. The saved questions and answer key are reused. You do not upload the paper again. Preview the paper and click **Open examination**.
5. Share the remote examination link with the class. All eligible active students use their **admission number and existing student password** (the student login used by CBT). No manual registration or individual examination access card is required. Use **View / print access instructions** if needed.

Eligibility is checked against the selected branch, section, academic period, class and subject. Newly eligible students can sign in after the examination opens. Inactive or exited students cannot start a new attempt. An existing attempt resumes instead of restarting, and existing scorebook marks are preserved when results are posted.

The remote sitting keeps its own verified private copy of the paper. Local servers continue to pull and use their existing test; their schedules, answers and scores are unchanged. Theory candidates type their numbered written answers and staff mark them before posting. Only papers still available in cloud storage can be reused. A paper removed from cloud storage must be restored/uploaded before it can be used remotely.

This is a web companion change. The desktop **Entrance / remote exams** shortcut opens the same updated page; it does not require another desktop installer.

## Prepare and issue an examination

1. Create an examination for a session, term, applying class and entrance subject. For enrolled students choose the academic class, subject/teacher and assessment component. When a component is split, Objective and Theory are separate papers; the selected part must accept Built-in CBT or Any approved source.
2. Set the opening/closing window and duration. Staff schedule fields use West Africa Time. Add multiple-choice and/or written-answer questions. Question marks must total the configured subject/part maximum.
3. Save the draft. For admission applicants, register candidates and choose **School network (offline)** or **Remote over internet**. New enrolled-student tests automatically admit all eligible students; no registration is needed.
4. Click **Open examination**. This freezes the paper and applicant delivery assignments. Existing attempts cannot be replaced by saving another paper with the same subject/test identity. Check the paper before opening.
5. For applicants, use **Preview / print access cards** and give each applicant only their own card. It contains the link or LAN instructions and an examination password. For enrolled students, share the remote test link; they use their existing student password.

## Upload a Word or PDF question paper

In the examination editor, choose **Upload Word / PDF paper** under question format. Upload a **.docx** or **.pdf** file (up to 8 MB and 12 pages). Save older `.doc` files as `.docx` or PDF first.

Check every rendered preview page, including diagrams, equations and page breaks, and tick the preview confirmation. If Word formatting differs, export the original to PDF and upload that version. Upload the question paper only; do not include its answer key in the document candidates will see.

Enter the question count (1–200), the number of answer options (2–6), and paste the correct-answer letters in order, for example `B D A C`. You do not need to type each question or option again. This mode creates a numbered multiple-choice answer sheet and divides the configured maximum equally between questions. Use individual-question entry for written responses or different marks per question.

Save the draft, register candidates, check the paper, then open the examination and print the access cards. Remote candidates see the paper beside their numbered answer sheet; **Zoom in**, **Zoom out** and **Fit width** help on small screens. The paper becomes available only after an authorized candidate starts the examination.

The updated desktop server downloads the same paper pages when pulling an entrance examination. School-network candidates can read and answer it without internet during the sitting. Uploaded source files and page images are stored privately; a public file URL is not issued.

## Remote sitting

Candidates open the HTTPS examination link on a computer, phone or tablet, sign in, then click **Start test** and confirm. Applicants must have a remote assignment; a school-network applicant cannot sign in remotely. New enrolled-student examinations use automatic academic eligibility. Older examinations that were opened with individual registrations retain their original access cards and assignments.

Answers save automatically. The server controls the timer, and the closing time can shorten a late starter's available duration. The timer does not restart on reload or reconnect. Keep the same browser tab open during temporary connection problems: it retains an unsent recovery copy and retries. Only answers received by the server before the deadline can be marked after time expires. The page displays a submission receipt only after confirmation from the school server.

The same attempt can resume, but cannot restart after submission. A second browser cannot take over an active session until its one-minute lease expires. Use a current browser with JavaScript, cookies and site storage enabled. This provides controlled delivery and result integrity; it does not provide remote invigilation.

## School-network entrance sitting

1. Connect the updated desktop CBT server to the internet. Open **Local CBT Server → Entrance exams** with the local server stopped.
2. Refresh the schedule, select the entrance examination and **Pull selected entrance exam**. The list distinguishes new and already-pulled exams. One entrance paper's offline register is reserved to the pulling CBT server to prevent the same applicants sitting on two disconnected servers.
3. Start the CBT server and connect candidates to its school Wi-Fi/LAN address or QR code. Candidates use the **ENT-… login ID** and password on their card. Internet is not required while they write on this network. The server computer and local network must stay on.
4. After the sitting, stop the server. Close the examination and use **Mark / Review** to mark answers, review and approve results.
5. Reconnect to the internet, open **Entrance exams**, select the examination and **Upload entrance results**. Answers and original marks stay in the local database. A repeated pull or upload preserves them. Green means all completed attempts have confirmed application results online; unconfirmed records stay pending and can be retried.

Offline entrance identities are separate from enrolled students. Do not use the regular academic score upload for entrance marks; the application register is their destination.

## Review and results

Open the examination register and **Refresh results**. **Review** shows the submitted answers and automatic multiple-choice marks. Mark written answers, approve, then **Post result**, or **Post approved results** for the register. Offline results approved on the CBT server are uploaded and posted from the entrance console.

Entrance marks update the original application's configured entrance-subject results. Enrolled-student marks use the existing verified scorebook synchronization flow, including distinct Objective/Theory cells. An existing mark, including zero, is preserved. One failed posting does not prevent other approved results from posting. Registration, approval and posting are audited. Posting an entrance score changes only entrance-result fields; payments, admission history and other application fields remain untouched.

## Technical verification

Service tests: `node --test tests/portal-cbt.test.mjs tests/academic-cbt-multiserver.test.mjs tests/academic-scorebook.test.mjs`.

Browser checks: `node scripts/verify-portal-cbt-ui.mjs`, with Playwright installed or `PLAYWRIGHT_MODULE` set to its module directory. The harness uses synthetic records and an in-memory database only. It checks authoring, cards/printing, phone layout, show/hide password, dialogue dismissal, failed-network answer recovery, submission, review and application posting.

Desktop tests: `python -m unittest tests.test_entrance_cbt tests.test_local_cbt tests.test_local_cbt_reliability tests.test_local_cbt_console_layout`. Test databases are temporary. No migration or production-record rewrite is needed to introduce the feature. A web deployment and updated desktop build are needed before schools can use the new screens on installed systems.
