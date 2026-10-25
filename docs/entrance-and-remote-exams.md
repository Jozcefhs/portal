# Entrance and remote examinations

## Where to start

In the web companion, open **Applications → Entrance examinations**, or **Academic Management → Entrance / remote exams**. The selected school, branch and school section apply. School management, ICT and authorized admissions/examination staff can manage admission exams; enrolled-student exams require academic review permission.

Choose **Admission applicants** or **Enrolled students — remote tests**. Each school configures its entrance subjects and maximum marks in **School setup → Entrance examination subjects**. There is no fixed three-subject requirement. Existing student tests on the school network continue through the normal Local CBT Server workflow.

## Prepare and issue an examination

1. Create an examination for a session, term, applying class and entrance subject. For enrolled students choose the academic class, subject/teacher and assessment component. When a component is split, Objective and Theory are separate papers; the selected part must accept Built-in CBT or Any approved source.
2. Set the opening/closing window and duration. Staff schedule fields use West Africa Time. Add multiple-choice and/or written-answer questions. Question marks must total the configured subject/part maximum.
3. Save the draft. Register the intended candidates from the current applicant/student roster. Applicants can be assigned **School network (offline)** or **Remote over internet**. Remote enrolled-student tests require explicit registration.
4. Click **Open examination**. This freezes the paper, register and delivery assignments. Existing attempts cannot be replaced by saving another paper with the same subject/test identity. Finish registration and check the paper before opening.
5. Use **Preview / print access cards**. Give each candidate only their own card. It contains the examination link or LAN instructions, reference/login and generated examination password. These are separate from ordinary student portal passwords.

## Remote sitting

Candidates open the HTTPS link on their card on a computer, phone or tablet, sign in, then click **Start test** and confirm. Remote access is restricted to registered candidates. A school-network assignment cannot sign in remotely.

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
