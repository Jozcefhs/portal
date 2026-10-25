# Dynamax v3.1.56

- Entrance and remote examinations accept Word (.docx) and PDF question papers, with page previews and a bulk answer key. Candidates read the uploaded paper and use a numbered multiple-choice answer sheet. Remote paper access requires an active authorized attempt; offline entrance servers receive verified copies of the same pages.
- Remote candidates can zoom paper pages on smaller screens. Existing individual-question entry remains available for written answers and custom question marks.
- The desktop class score register retains recently loaded grades and their selected test, search and page when switching grades or reopening the register. Returning to a loaded grade does not issue another score request; Reload class scores explicitly retrieves fresh records.
- Cached registers are separated by user, workspace, branch, section, session and term, and invalidated after academic changes. Test choices display readable names without internal component IDs.
- Existing marks, answers, payments and academic history are preserved. This release performs no live examination, score posting or record migration.

Guide: [Entrance and remote examinations](https://github.com/Jozcefhs/portal/blob/main/docs/entrance-and-remote-exams.md).

Verification: 4,090 web tests and 1,064 desktop tests passed across the full regression runs and targeted follow-up checks. Browser verification covers Word/PDF preview under production security policy, remote phone layout and zoom, marking, answer recovery, and offline paper imports. The compiled installer passes its packaged self-test.
