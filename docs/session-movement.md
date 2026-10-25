# Session Movement

Desktop v3.1.55 uses the academic membership writer for session and term movement.

1. In Academic Management, configure the destination session and term, classes, classrooms and curriculum.
2. Open Applications → Session Movement. Choose the current class, destination class, new session and term, and Promoted or Repeating.
3. Leave Destination arm blank to keep each student's current arm name. Enter an arm name to use that configured destination classroom for everyone selected. A student without an arm can remain unassigned. An unknown named destination arm is reported without changing that student.
4. Select the students and click Move Selected. Review Moved, Already moved and Not moved. Correct any listed configuration issue, then retry the affected selection.

Each student is committed independently: their current profile, destination-period membership, movement receipt and audit are atomic. Previous-period memberships, scores, answers, attendance, payments and other records are retained. New-period subject allocation uses the destination curriculum; check Senior Trade/Optional choices after moving. Marks from the previous session are not copied into the new session.

The receipt is keyed by branch, school section, student and destination period. A repeat or a lost-response retry does not create another membership or promotion-history entry, and cannot undo a later transfer. A previously created matching legacy membership is reused. A destination already assigned to another classroom is reported for review rather than overwritten. Class/arm changes within the same period use Academic Management → Transfer or reassign.

Failed students do not block later students in the batch. The client keeps the interface responsive, prevents double submission, retains request revisions, shows partial results explicitly, and updates returned rows without rereading the entire register. No live students are moved by the deployment or test suite.
