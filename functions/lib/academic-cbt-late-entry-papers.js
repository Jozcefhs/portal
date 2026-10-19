import {getStoredDocument, putStoredDocument} from './document-storage.js';

// Independent copies prevent removing an old sitting's cloud paper from
// breaking a later sitting. Stable keys make a lost-response retry harmless.
export async function copyAcademicCbtLateEntryPapers(env, source, id, dependencies = {}) {
  const get = dependencies.get || getStoredDocument, put = dependencies.put || putStoredDocument;
  const result = {};
  let total = 0;
  for (const theory of [false, true]) {
    if (theory && source.PaperMode !== 'split') continue;
    const prefix = theory ? 'TheoryPaper' : 'Paper';
    const files = source[`${prefix}Files`]?.length ? source[`${prefix}Files`] : [{Url:source[`${prefix}Url`],
      FileName:source[`${prefix}FileName`], MimeType:source[`${prefix}MimeType`], Digest:source[`${prefix}Digest`], ByteLength:source[`${prefix}ByteLength`]}];
    if (!files.length || files.length > 12) throw new Error('The original paper page list is invalid.');
    const copies = [];
    for (const [index, file] of files.entries()) {
      const stored = await get(env, file.Url);
      const size = Number(stored.object.size);
      if (!Number.isFinite(size) || size < 1 || size > 8 * 1024 * 1024 || total + size > 32 * 1024 * 1024) {
        throw new Error('The original paper exceeds the safe copy size.');
      }
      const bytes = new Uint8Array(await stored.object.arrayBuffer());
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
      if (bytes.length !== size || digest !== file.Digest) throw new Error('The original paper no longer matches its saved digest.');
      total += bytes.length;
      const copy = await put(env,{bytes,fileName:file.FileName,mimeType:file.MimeType,category:'academic-cbt',
        branchId:source.BranchId,schoolSection:source.SchoolSection,ownerId:id,
        documentType:theory ? 'late-entry-theory' : 'late-entry-objective',operationId:`page-${index+1}`});
      copies.push({...file,Url:copy.reference,ByteLength:bytes.length,PageNumber:index+1});
    }
    result[`${prefix}Files`] = copies;
    for (const [key, field] of [['Url','Url'],['FileName','FileName'],['MimeType','MimeType'],['Digest','Digest'],['ByteLength','ByteLength']]) result[`${prefix}${key}`] = copies[0][field];
  }
  return result;
}
