const clean = (value) => String(value ?? '').trim();

export const PUBLIC_PORTAL_CONTENT_DOCUMENT = 'publicPortalContent';

export const PUBLIC_PORTAL_CONTENT_FIELDS = Object.freeze([
  'PortalHeadline',
  'PortalSubheading',
  'PortalNotice'
]);

export function publicPortalContent(profile = {}) {
  return Object.fromEntries(PUBLIC_PORTAL_CONTENT_FIELDS.map((field) => [
    field,
    clean(profile?.[field])
  ]));
}

export function applyPublicPortalContent(profile = {}, savedContent = null) {
  const effective = { ...(profile || {}) };
  if (!savedContent || typeof savedContent !== 'object') return effective;
  PUBLIC_PORTAL_CONTENT_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(savedContent, field)) {
      effective[field] = clean(savedContent[field]);
    }
  });
  return effective;
}
