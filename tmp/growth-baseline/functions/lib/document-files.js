const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 300 * 1024;

const TYPES = {
  '.pdf': {
    mimeType: 'application/pdf',
    signatures: [[0x25, 0x50, 0x44, 0x46, 0x2d]],
    inlineSafe: true
  },
  '.jpg': {
    mimeType: 'image/jpeg',
    signatures: [[0xff, 0xd8, 0xff]],
    inlineSafe: true
  },
  '.jpeg': {
    mimeType: 'image/jpeg',
    signatures: [[0xff, 0xd8, 0xff]],
    inlineSafe: true
  },
  '.png': {
    mimeType: 'image/png',
    signatures: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    inlineSafe: true
  },
  '.doc': {
    mimeType: 'application/msword',
    signatures: [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
    inlineSafe: false
  },
  '.docx': {
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    signatures: [[0x50, 0x4b, 0x03, 0x04]],
    inlineSafe: false
  }
};

function clean(value) {
  return String(value ?? '').trim();
}

export function admissionApplicationScopePath(value) {
  const rawPath = clean(value).replace(/^\/+|\/+$/g, '');
  const path = rawPath.toLowerCase() === 'students'
    ? 'applications'
    : rawPath.replace(/\/students$/i, '/applications');
  if (!path) return '';
  if (path.toLowerCase() === 'applications') return 'applications';
  return /^schoolBranches\/[a-z0-9._-]+\/sections\/(?:primary|secondary)\/applications$/i.test(path)
    ? path
    : '';
}

export function admissionStudentScopePath(value) {
  const rawPath = clean(value).replace(/^\/+|\/+$/g, '');
  const path = rawPath.toLowerCase() === 'applications'
    ? 'students'
    : rawPath.replace(/\/applications$/i, '/students');
  if (!path) return '';
  if (path.toLowerCase() === 'students') return 'students';
  return /^schoolBranches\/[a-z0-9._-]+\/sections\/(?:primary|secondary)\/students$/i.test(path)
    ? path
    : '';
}

function thumbnailReference(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

export async function admissionThumbnailDocumentId(reference, scopePath = 'applications') {
  const normalizedReference = thumbnailReference(reference);
  const normalizedScope = admissionApplicationScopePath(scopePath) || 'applications';
  if (!normalizedReference) throw new Error('An application reference is required for the passport thumbnail.');
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${normalizedScope.toLowerCase()}|${normalizedReference}`)
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `passport-${hex}`;
}

function safeName(value) {
  const leaf = clean(value).split(/[\\/]/).pop()
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  if (!leaf) throw new Error('The uploaded file name is invalid.');
  const extension = fileExtension(leaf);
  if (leaf.length <= 180) return leaf;
  return `${leaf.slice(0, Math.max(1, 180 - extension.length))}${extension}`;
}

function fileExtension(fileName) {
  const match = clean(fileName).toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : '';
}

function base64Info(value) {
  const encoded = clean(value);
  if (!encoded || encoded.length % 4 !== 0 || !/^[a-z0-9+/]*={0,2}$/i.test(encoded)) {
    throw new Error('The uploaded file is not valid base64 data.');
  }
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const byteLength = (encoded.length / 4) * 3 - padding;
  const prefixLength = Math.min(encoded.length, 24);
  const alignedLength = prefixLength - (prefixLength % 4);
  let binary = '';
  try {
    binary = atob(encoded.slice(0, alignedLength));
  } catch {
    throw new Error('The uploaded file is not valid base64 data.');
  }
  return {
    byteLength,
    prefix: Uint8Array.from(binary, (character) => character.charCodeAt(0))
  };
}

function signatureMatches(prefix, signatures) {
  return signatures.some((signature) =>
    signature.every((byte, index) => prefix[index] === byte)
  );
}

export function validateAdmissionDocumentFile(input = {}) {
  const fileName = safeName(input.fileName);
  const extension = fileExtension(fileName);
  const type = TYPES[extension];
  if (!type) {
    throw new Error('Only PDF, JPG, PNG, DOC and DOCX files are accepted.');
  }
  if (clean(input.documentType).toLowerCase() === 'passportphotograph' &&
      !['.jpg', '.jpeg', '.png'].includes(extension)) {
    throw new Error('Passport photographs must be JPG or PNG images.');
  }
  const info = base64Info(input.fileBase64);
  if (info.byteLength < 1 || info.byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error('The selected file exceeds the 8 MB upload limit.');
  }
  if (!signatureMatches(info.prefix, type.signatures)) {
    throw new Error(`The file contents do not match the ${extension.slice(1).toUpperCase()} file type.`);
  }
  return {
    fileName,
    mimeType: type.mimeType,
    byteLength: info.byteLength,
    inlineSafe: type.inlineSafe
  };
}

export function validateAdmissionThumbnail(fileBase64) {
  if (!clean(fileBase64)) return { mimeType: '', byteLength: 0 };
  const info = base64Info(fileBase64);
  if (info.byteLength < 1 || info.byteLength > MAX_THUMBNAIL_BYTES) {
    throw new Error('The image preview is too large.');
  }
  const imageType = ['.jpg', '.png'].map((extension) => TYPES[extension])
    .find((type) => signatureMatches(info.prefix, type.signatures));
  if (!imageType) throw new Error('The image preview must be a JPG or PNG image.');
  return { mimeType: imageType.mimeType, byteLength: info.byteLength };
}

export function safeStoredDocument(fileName, fileBase64) {
  try {
    const validated = validateAdmissionDocumentFile({ fileName, fileBase64 });
    return {
      fileName: validated.fileName,
      mimeType: validated.mimeType,
      inlineSafe: validated.inlineSafe,
      valid: true
    };
  } catch {
    let fallbackName = 'document.bin';
    try {
      fallbackName = safeName(fileName || fallbackName);
    } catch {}
    return {
      fileName: fallbackName,
      mimeType: 'application/octet-stream',
      inlineSafe: false,
      valid: false
    };
  }
}
