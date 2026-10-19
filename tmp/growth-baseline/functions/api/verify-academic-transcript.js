import { queryCollection } from '../lib/firestore.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

export async function onRequestGet({ request, env }) {
  try {
    const number = clean(new URL(request.url).searchParams.get('number')).toUpperCase();
    if (!/^TRN-[A-F0-9]{16}$/.test(number)) {
      return Response.json({ ok: false, valid: false, message: 'Enter a valid transcript number.' }, {
        status: 400, headers: { 'Cache-Control': 'no-store' }
      });
    }
    const rows = await queryCollection(env, 'academicTranscripts', {
      filters: [{ field: 'TranscriptNumber', op: '==', value: number }],
      limit: 2
    }).catch(() => []);
    const transcript = rows.find((row) => lower(row.TranscriptNumber) === lower(number));
    const priorIssued = [...(transcript?.PreviousIssuedVersions || [])]
      .reverse()
      .find((row) => lower(row.Status) === 'issued');
    const issued = lower(transcript?.Status) === 'issued' ? transcript : priorIssued;
    if (!transcript || !issued) {
      return Response.json({ ok: true, valid: false, message: 'No currently issued transcript matches this number.' }, {
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    return Response.json({
      ok: true,
      valid: true,
      message: 'This number matches an issued official academic transcript.',
      transcript: {
        TranscriptNumber: clean(transcript.TranscriptNumber),
        Status: 'Issued',
        Version: Number(issued.Version || 1),
        SessionCount: Number((issued.Sessions || []).length),
        IssuedAt: clean(issued.IssuedAt),
        SchoolSection: clean(transcript.SchoolSection)
      }
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, valid: false, message: error?.message || 'Transcript verification is unavailable.' }, {
      status: Number(error?.status || 500), headers: { 'Cache-Control': 'no-store' }
    });
  }
}
