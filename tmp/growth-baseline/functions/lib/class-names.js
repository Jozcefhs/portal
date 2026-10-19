function clean(value) { return String(value ?? '').trim(); }

const NUMBER_WORDS = {
  one: '1', first: '1', two: '2', second: '2', three: '3', third: '3',
  four: '4', fourth: '4', five: '5', fifth: '5', six: '6', sixth: '6',
  seven: '7', seventh: '7', eight: '8', eighth: '8', nine: '9', ninth: '9'
};

export function normalizeClassKey(value) {
  let text = clean(value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  if (!text || ['all', '*'].includes(text)) return text || '';
  text = text.replace(/\b(one|first|two|second|three|third|four|fourth|five|fifth|six|sixth|seven|seventh|eight|eighth|nine|ninth)\b/g, (word) => NUMBER_WORDS[word]);
  text = text.replace(/\bclass\b/g, ' ').replace(/[._/\\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/\b(creche|daycare|playgroup)\b/.test(text)) return 'creche';
  if (/\bpre\s*nursery\b|\bprenursery\b/.test(text)) return 'prenursery';
  let match = text.match(/\b(?:nursery|kg)\s*([1-3])\b/);
  if (match) return `nursery${match[1]}`;
  match = text.match(/\b(?:primary|grade|basic)\s*([1-6])\b/);
  if (match) return `primary${match[1]}`;
  match = text.match(/\bbasic\s*([7-9])\b/);
  if (match) return `jss${Number(match[1]) - 6}`;
  match = text.match(/\b(?:jss|junior\s*secondary)\s*([1-3])\b/);
  if (match) return `jss${match[1]}`;
  match = text.match(/\b(?:ss|sss|senior\s*secondary)\s*([1-3])\b/);
  if (match) return `ss${match[1]}`;
  return text.replace(/[^a-z0-9]/g, '');
}

export function classNamesMatch(left, right) {
  const a = normalizeClassKey(left);
  const b = normalizeClassKey(right);
  return Boolean(a && b && a === b);
}

export function canonicalConfiguredClass(value, configured = []) {
  const wanted = normalizeClassKey(value);
  if (!wanted || ['all', '*'].includes(wanted)) return clean(value) || 'All';
  const match = configured.find((item) => normalizeClassKey(typeof item === 'string' ? item : item?.ClassName || item?.className) === wanted);
  return clean(typeof match === 'string' ? match : match?.ClassName || match?.className) || clean(value);
}
