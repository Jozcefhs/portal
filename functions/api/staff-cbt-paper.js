import { requiredDeploymentIdentity } from '../lib/deployment-identity.js';
import { requireFirestoreEnv } from '../lib/firestore.js';
import {
  deleteStoredDocument,
  putStoredDocument,
  resolveDocumentStorage
} from '../lib/document-storage.js';
import {
  academicCbtPaperDigest,
  validateAcademicCbtPaper
} from '../lib/academic-cbt-papers.js';
import {
  saveAcademicCbtTest,
  validateAcademicCbtTestInput
} from '../lib/academic-management.js';
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  failIdempotentRequest,
  readJsonBody
} from '../lib/request-security.js';
import { requireStaffSession } from '../lib/staff-auth.js';

const clean = (value) => String(value ?? '').trim();

function failure(message, status = 400, code = '') {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

function paperInputs(body = {}, key = 'Files') {
  if (Array.isArray(body[key]) && body[key].length) return body[key];
  if (key === 'Files' && clean(body.FileBase64)) {
    return [{ FileName: body.FileName, FileBase64: body.FileBase64, PageNumber: 1 }];
  }
  return [];
}

function validatedPaperSet(inputs = [], label = 'question paper') {
  if (!inputs.length || inputs.length > 12) {
    throw failure(`Choose one PDF or between 1 and 12 PNG/JPG pages for the ${label}.`, 400, 'ACADEMIC_CBT_PAPER_REQUIRED');
  }
  const papers = inputs.map((file) => validateAcademicCbtPaper(file));
  if (papers.some((paper) => paper.mimeType === 'application/pdf') && papers.length !== 1) {
    throw failure(`Choose one PDF by itself, or choose several PNG/JPG pages for the ${label}.`, 400, 'ACADEMIC_CBT_PAPER_MIXED_FORMAT');
  }
  return papers;
}

export async function onRequestPost(context) {
  return handleRequest(context);
}

async function handleRequest(context) {
  let idempotency = null;
  const uploadedUrls = [];
  let storage = null;
  let testSaved = false;
  try {
    const { request, env } = context;
    const deployment = requiredDeploymentIdentity(env);
    if (deployment.edition !== 'school') throw failure('CBT is available only in the School edition.', 404);
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 48 * 1024 * 1024 });
    const preview = await validateAcademicCbtTestInput(env, user, { ...body, RequirePaper: false });
    const splitPaper = preview.record.PaperMode === 'split';
    const inputs = paperInputs(body);
    const theoryInputs = paperInputs(body, 'TheoryFiles');
    const papers = validatedPaperSet(inputs, splitPaper ? 'Paper 1 Objective paper' : 'question paper');
    const theoryPapers = splitPaper ? validatedPaperSet(theoryInputs, 'Paper 2 Theory paper') : [];
    if ([...papers, ...theoryPapers].reduce((sum, paper) => sum + paper.byteLength, 0) > 32 * 1024 * 1024) {
      throw failure('Paper 1 and Paper 2 together exceed the 32 MB upload limit.', 413, 'ACADEMIC_CBT_PAPERS_TOO_LARGE');
    }
    idempotency = await beginIdempotentRequest(env, request, body, {
      scope: 'academic-cbt-paper', actor: clean(user.username), ttlMinutes: 30 * 24 * 60
    });
    if (!idempotency.enabled) throw failure('An idempotency key is required for CBT paper uploads.', 400, 'IDEMPOTENCY_KEY_REQUIRED');
    if (idempotency.replay) {
      return Response.json(idempotency.response, {
        status: idempotency.status || 200,
        headers: { 'Cache-Control': 'no-store', 'Idempotency-Replayed': 'true' }
      });
    }
    storage = await resolveDocumentStorage(env);
    if (!storage.configured) throw failure('Cloudflare R2 document storage is not connected.', 503, 'DOCUMENT_STORAGE_NOT_CONFIGURED');
    const uploadPaperSet = async (paperInputsValue, papersValue, paperType) => {
      const uploaded = [];
      for (let index = 0; index < papersValue.length; index += 1) {
        const paper = papersValue[index];
        const fileBase64 = clean(paperInputsValue[index]?.FileBase64);
        const digest = await academicCbtPaperDigest(fileBase64);
        const prefix = paperType === 'theory' ? 'theory-paper' : (splitPaper ? 'objective-paper' : 'question-paper');
        const stored = await putStoredDocument(env, {
          category: 'academic-cbt',
          branchId: preview.context.scope.branchId,
          schoolSection: preview.context.scope.schoolSection,
          ownerId: preview.record.CbtTestId,
          documentType: papersValue.length === 1 ? prefix : `${prefix}-page-${String(index + 1).padStart(3, '0')}`,
          operationId: idempotency.documentId,
          fileName: paper.fileName,
          mimeType: paper.mimeType,
          fileBase64,
          customMetadata: { uploadedBy: clean(user.username), pageNumber: index + 1, paperType }
        });
        uploadedUrls.push(stored.documentUrl);
        uploaded.push({
          Url: stored.documentUrl,
          FileName: paper.fileName,
          MimeType: paper.mimeType,
          Digest: digest,
          ByteLength: paper.byteLength,
          PageNumber: index + 1
        });
      }
      return uploaded;
    };
    const paperFiles = await uploadPaperSet(inputs, papers, 'objective');
    const theoryPaperFiles = splitPaper ? await uploadPaperSet(theoryInputs, theoryPapers, 'theory') : [];
    const firstPaper = paperFiles[0];
    const firstTheoryPaper = theoryPaperFiles[0] || {};
    const saved = await saveAcademicCbtTest(env, user, {
      ...body,
      Files: undefined,
      FileBase64: undefined,
      CbtTestId: preview.existing?.CbtTestId || '',
      PaperFiles: paperFiles,
      PaperUrl: firstPaper.Url,
      PaperFileName: firstPaper.FileName,
      PaperMimeType: firstPaper.MimeType,
      PaperDigest: firstPaper.Digest,
      PaperByteLength: firstPaper.ByteLength,
      TheoryFiles: undefined,
      TheoryPaperFiles: theoryPaperFiles,
      TheoryPaperUrl: firstTheoryPaper.Url || '',
      TheoryPaperFileName: firstTheoryPaper.FileName || '',
      TheoryPaperMimeType: firstTheoryPaper.MimeType || '',
      TheoryPaperDigest: firstTheoryPaper.Digest || '',
      TheoryPaperByteLength: Number(firstTheoryPaper.ByteLength || 0),
      RequirePaper: true
    }, { validation: preview });
    testSaved = true;
    const replacedRecords = [preview.existing, ...(preview.replacementCandidates || [])].filter(Boolean);
    const previousUrls = [...new Set(replacedRecords.flatMap((record) => {
      const objective = Array.isArray(record?.PaperFiles) && record.PaperFiles.length
        ? record.PaperFiles.map((file) => clean(file?.Url || file?.PaperUrl)).filter(Boolean)
        : [clean(record?.PaperUrl)].filter(Boolean);
      const theory = Array.isArray(record?.TheoryPaperFiles) && record.TheoryPaperFiles.length
        ? record.TheoryPaperFiles.map((file) => clean(file?.Url || file?.PaperUrl)).filter(Boolean)
        : [clean(record?.TheoryPaperUrl)].filter(Boolean);
      return [...objective, ...theory];
    }))];
    await Promise.all(previousUrls.filter((url) => !uploadedUrls.includes(url))
      .map((url) => deleteStoredDocument(env, url).catch(() => null)));
    const created = saved.cbtTest || {};
    const data = {
      ok: true,
      message: saved.message || 'CBT test scheduled online.',
      CbtTestId: preview.record.CbtTestId,
      RevisionToken: clean(created.RevisionToken),
      CbtTest: created
    };
    await completeIdempotentRequest(env, idempotency, data, 200);
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (uploadedUrls.length && storage && !testSaved) {
      await Promise.all(uploadedUrls.map((url) => deleteStoredDocument(context.env, url).catch(() => null)));
    }
    if (idempotency?.owner) await failIdempotentRequest(context.env, idempotency, error);
    return Response.json({
      ok: false,
      code: clean(error.code),
      outcomeUncertain: Boolean(error.outcomeUncertain),
      message: clean(error.message) || 'The CBT test could not be scheduled.'
    }, {
      status: Number(error.status || 500),
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}

export function onRequestGet() {
  return Response.json({ ok: false, message: 'Method not allowed.' }, {
    status: 405,
    headers: { Allow: 'POST', 'Cache-Control': 'no-store' }
  });
}
