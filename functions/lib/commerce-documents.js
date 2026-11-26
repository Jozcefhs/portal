export function businessReference(value, label) {
  const id = String(value ?? '').trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,95}$/i.test(id)) {
    throw Object.assign(new Error('Enter a valid '+label+' using letters, numbers, hyphens or dots.'),{status:400});
  }
  return id;
}
export const publicRow = row => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('__')));
export const createRow = (collectionPath, documentId, data) => ({collectionPath, documentId, data, exists:false, restoreJsonTypes:true});
export function reviseRow(collectionPath, row, changes) {
  if (!row?.__updateTime) throw Object.assign(new Error('Record revision unavailable. Refresh before retrying.'),{status:409});
  return {collectionPath, documentId:row.__id, literalDocumentId:true, restoreJsonTypes:true, updateTime:row.__updateTime, data:{...publicRow(row),...changes}};
}
