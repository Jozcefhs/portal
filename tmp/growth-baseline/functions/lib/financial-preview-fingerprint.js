// Firestore field order and query-result order are not financial changes.
// Keep every value (including document revisions) in the fingerprint; only
// document collections are unordered. Nested arrays such as journal lines
// retain their order. All operations use copies, never the source records.
function canonicalJson(value) {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  });
}

export async function financialPreviewFingerprint(snapshot, documentCollections = []) {
  const stable = { ...snapshot };
  for (const key of documentCollections) {
    if (!Array.isArray(stable[key])) continue;
    stable[key] = stable[key].map((row) => ({ row, signature: canonicalJson(row) }))
      .sort((a, b) => a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0)
      .map(({ row }) => row);
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(stable)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
