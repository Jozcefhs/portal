import QRCode from 'qrcode';

const clean = (value) => String(value ?? '').trim();

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const number = clean(url.searchParams.get('number')).toUpperCase();
  if (!/^TRN-[A-F0-9]{16}$/.test(number)) {
    return new Response('Invalid transcript number.', { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const verificationUrl = `${url.origin}/verify-transcript.html?number=${encodeURIComponent(number)}`;
  const svg = await QRCode.toString(verificationUrl, {
    type: 'svg', errorCorrectionLevel: 'M', margin: 1, width: 144,
    color: { dark: '#17324d', light: '#ffffff' }
  });
  return new Response(svg, {
    headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' }
  });
}
