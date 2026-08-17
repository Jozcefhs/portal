import { queryCollection } from '../lib/firestore.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

export async function onRequestGet({ request, env }) {
  try {
    const reference = clean(new URL(request.url).searchParams.get('reference'));
    if (!/^TR-[A-F0-9]{16}$/i.test(reference)) {
      return Response.json({ ok: false, valid: false, message: 'Enter a valid term-result reference.' }, {
        status: 400, headers: { 'Cache-Control': 'no-store' }
      });
    }
    const rows = await queryCollection(env, 'academicResults', {
      filters: [{ field: 'ResultReference', op: '==', value: reference.toUpperCase() }],
      limit: 2
    }).catch(() => []);
    const result = rows.find((row) => lower(row.ResultReference) === lower(reference));
    if (!result || !['published', 'locked'].includes(lower(result.PublicationStatus || result.Status))) {
      return Response.json({ ok: true, valid: false, message: 'No currently published result matches this reference.' }, {
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    return Response.json({
      ok: true,
      valid: true,
      message: 'This reference matches a published school result.',
      result: {
        ResultReference: clean(result.ResultReference),
        AcademicSession: clean(result.AcademicSession || result.SessionName),
        Term: clean(result.Term || result.TermName),
        ClassName: clean(result.ClassName),
        ArmName: clean(result.ArmName),
        PublicationStatus: clean(result.PublicationStatus || result.Status),
        PublishedAt: clean(result.PublishedAt),
        SubjectCount: Number(result.SubjectCount || (result.Subjects || []).length || 0)
      }
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, valid: false, message: error?.message || 'Result verification is unavailable.' }, {
      status: Number(error?.status || 500), headers: { 'Cache-Control': 'no-store' }
    });
  }
}
