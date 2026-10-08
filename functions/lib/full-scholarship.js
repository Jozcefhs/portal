const normalized = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export function isFullScholarship(value) {
  return normalized(value) === 'full scholarship';
}

// "All", blank and wildcard rules are not explicit scholarship assignments.
export function explicitlyIncludesFullScholarship(categories = []) {
  return !categories.some((value) => ['all', '*'].includes(normalized(value))) &&
    categories.some(isFullScholarship);
}
