const clean = (value) => String(value ?? '').trim();

export function mergedProfileText(existing = {}, incoming = {}, field, aliases = [], fallback = '') {
  const keys = [field, ...(Array.isArray(aliases) ? aliases : [aliases])].filter(Boolean);
  const suppliedKey = keys.find((key) => Object.prototype.hasOwnProperty.call(incoming || {}, key));
  if (suppliedKey) return clean(incoming[suppliedKey]) || clean(fallback);
  return clean(existing?.[field]) || clean(fallback);
}
