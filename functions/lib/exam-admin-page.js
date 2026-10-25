// Authorize only renderer-created styles with a fresh nonce. Script execution
// remains restricted to local files; uploaded documents cannot add scripts.
export async function secureExamAdminPage(response) {
  if (!response.ok || !response.headers.get('Content-Type')?.includes('text/html')) return response;
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const nonce = btoa(String.fromCharCode(...bytes));
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.delete('Content-Length'); headers.delete('ETag');
  headers.set('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; font-src 'self' data:; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
  headers.set('Referrer-Policy', 'no-referrer'); headers.set('X-Frame-Options', 'DENY');
  const html = (await response.text()).replace(/<head>/i, `<head><meta name="exam-style-nonce" content="${nonce}">`);
  return new Response(html, { status: response.status, headers });
}
