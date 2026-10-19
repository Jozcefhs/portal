// Cloudflare Pages Function: /api/admission-classes
// Returns classes currently open for admission.

import { getAdmissionClasses } from './backend.js';
import { requireFirestoreEnv } from '../lib/firestore.js';
import { getSchoolStructure, safeScopeId } from '../lib/school-scope.js';

function json(data, init = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      ...(init.headers || {}),
      'Cache-Control': 'no-store'
    }
  });
}

export async function onRequestGet(context) {
  try {
    const { env, request } = context;
    requireFirestoreEnv(env);
    const structure = await getSchoolStructure(env);
    const availableBranches = (structure.Branches || []).map((branch) => ({
      id: safeScopeId(branch.Id || branch.Name),
      name: String(branch.Name || branch.Id || '').trim()
    })).filter((branch) => branch.id && branch.name);
    const url = new URL(request.url);
    const requestedBranchId = String(url.searchParams.get('branchId') || url.searchParams.get('branch') || '').trim();
    const selectedBranchId = safeScopeId(requestedBranchId || structure.ActiveBranchId || availableBranches[0]?.id || 'main');
    const data = await getAdmissionClasses(env, { BranchId: selectedBranchId });
    return json({
      ok: true,
      classes: data.openClassOptions || data.openClasses || [],
      openClasses: data.openClasses || [],
      allClasses: data.classes || [],
      formAmount: data.formAmount || '',
      branchId: data.branchId || selectedBranchId,
      branchName: data.branchName || availableBranches.find((branch) => branch.id === selectedBranchId)?.name || selectedBranchId,
      availableBranches,
      inherited: Boolean(data.inherited),
      setupMode: data.setupMode || 'inherit',
      backend: 'firestore'
    });
  } catch (err) {
    return json({ ok: false, message: err.message || String(err) }, { status: err.status || 500 });
  }
}
