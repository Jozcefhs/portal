import { validateAcademicCbtPaper, academicCbtPaperDigest } from './academic-cbt-papers.js';
import { requiredDeploymentIdentity } from './deployment-identity.js';

const fail = message => Object.assign(new Error(message), { status: 400 });
export function documentQuestions(input) {
  const count = Number(input.NumberOfQuestions), maximum = Number(input.MaximumScore), options = Number(input.OptionCount || 4);
  if (!Number.isInteger(count) || count < 1 || count > 200 || !Number.isFinite(maximum) || maximum <= 0) throw fail('Enter 1–200 questions and the paper maximum.');
  if (!Number.isInteger(options) || options < 2 || options > 6) throw fail('Choose between 2 and 6 answer options.');
  const keys = Array.isArray(input.AnswerKey) ? input.AnswerKey : String(input.AnswerKey || '').toUpperCase().split(/[\s,;]+/).filter(Boolean);
  if (keys.length !== count || keys.some(key => !'ABCDEF'.slice(0, options).includes(key) || key.length !== 1)) throw fail('Provide one correct answer letter for each question, in order.');
  const share = Math.floor(maximum / count * 1000000) / 1000000;
  return Array.from({ length: count }, (_, i) => ({ QuestionId: `Q${i + 1}`, QuestionType: 'single',
    Prompt: `Answer question ${i + 1} from the uploaded paper.`, Options: [...'ABCDEF'.slice(0, options)], AnswerKey: keys[i],
    MaximumScore: i === count - 1 ? Number((maximum - share * (count - 1)).toFixed(6)) : share }));
}

export async function saveExamPaper(env, testId, input) {
  const bucket = env.DYNAMAX_DOCUMENTS;
  if (!bucket?.put || !bucket?.get) throw Object.assign(new Error('Document storage is not connected.'), { status: 503 });
  if (!input.PreviewConfirmed) throw fail('Preview the complete paper and confirm every page is readable before saving.');
  if (!Array.isArray(input.Pages) || !input.Pages.length || input.Pages.length > 12) throw fail('Upload a paper containing 1–12 pages.');
  const pages = input.Pages.map(page => {
    const validated = validateAcademicCbtPaper(page);
    if (!['image/png', 'image/jpeg'].includes(validated.mimeType)) throw fail('Convert the paper to preview pages before saving.');
    return { ...validated, FileBase64: page.FileBase64 };
  });
  const source = input.Source || {}, name = String(source.FileName || '');
  if (!/\.(pdf|docx)$/i.test(name) || name.length > 180) throw fail('Choose a PDF or Word .docx question paper.');
  let bytes;
  try { bytes = Uint8Array.from(atob(source.FileBase64 || ''), c => c.charCodeAt(0)); } catch { throw fail('The source document is damaged.'); }
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw fail('The source document must be at most 8 MB.');
  if (/\.pdf$/i.test(name) ? new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-' : !(bytes[0] === 80 && bytes[1] === 75 && bytes[2] === 3 && bytes[3] === 4)) throw fail('The file content does not match its document type.');
  if (pages.reduce((n, page) => n + page.byteLength, bytes.length) > 32 * 1024 * 1024) throw fail('The paper and preview pages exceed 32 MB.');
  const workspace = requiredDeploymentIdentity(env).workspaceId;
  const digest = await academicCbtPaperDigest(source.FileBase64);
  const pageDigests = await Promise.all(pages.map(page => academicCbtPaperDigest(page.FileBase64)));
  const fingerprint = await academicCbtPaperDigest(btoa(JSON.stringify([digest, pageDigests])));
  const prefix = `private-portal-cbt/${encodeURIComponent(workspace)}/${testId}/${fingerprint}`;
  const sourceKey = `${prefix}/source.${/\.pdf$/i.test(name) ? 'pdf' : 'docx'}`;
  if (!await bucket.put(sourceKey, bytes)) throw new Error('The source paper upload was not confirmed.');
  const saved = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i], key = `${prefix}/page-${i + 1}.${page.mimeType === 'image/png' ? 'png' : 'jpg'}`;
    if (!await bucket.put(key, Uint8Array.from(atob(page.FileBase64), c => c.charCodeAt(0)), { httpMetadata: { contentType: page.mimeType } })) throw new Error('The page upload was not confirmed.');
    saved.push({ Key: key, MimeType: page.mimeType, FileName: `page-${i + 1}.${page.mimeType === 'image/png' ? 'png' : 'jpg'}`, Digest: pageDigests[i], ByteLength: page.byteLength });
  }
  return { FileName: name, SourceKey: sourceKey, Digest: digest, Pages: saved };
}

export async function readExamPage(env, paper, index) {
  if (!Number.isInteger(index) || index < 0 || index >= (paper?.Pages?.length || 0)) throw Object.assign(new Error('This paper page is unavailable.'), { status: 404 });
  const page = paper.Pages[index], object = await env.DYNAMAX_DOCUMENTS?.get(page.Key);
  if (!object) throw Object.assign(new Error('The paper page could not be loaded. Retry before continuing.'), { status: 503 });
  const bytes = new Uint8Array(await object.arrayBuffer());
  let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const base64 = btoa(binary);
  if (await academicCbtPaperDigest(base64) !== page.Digest) throw new Error('The saved paper page failed its integrity check.');
  return { FileName: page.FileName, MimeType: page.MimeType, Digest: page.Digest, FileBase64: base64 };
}
