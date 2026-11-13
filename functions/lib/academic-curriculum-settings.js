// A missing setting preserves the established compulsory Trade curriculum.
// This controls selection only; it never removes enrolled subjects or marks.
export function academicTradeRequired(state = {}) {
  return state.curriculumSettings?.RequireTradeSubject !== false;
}

export function academicCurriculumSettingId(branchId) {
  return `academic-curriculum-${String(branchId).trim().toLowerCase()}`;
}
