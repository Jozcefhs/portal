/* Local-only conversion: no document is sent to an external rendering service. */
(() => {
  const scripts = new Map();
  function script(name) {
    if (!scripts.has(name)) scripts.set(name, new Promise((resolve, reject) => {
      const el = document.createElement('script'); el.src = `/vendor/exam-documents/${name}`;
      el.onload = resolve; el.onerror = () => { scripts.delete(name); reject(new Error('The document renderer could not load. Check the connection and retry.')); }; document.head.append(el);
    }));
    return scripts.get(name);
  }
  const encoded = bytes => { let text = ''; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(text); };
  async function convert(file, progress = () => {}) {
    if (!file || !/\.(pdf|docx)$/i.test(file.name)) throw new Error('Choose a PDF or Word .docx file. Save older .doc files as .docx or PDF first.');
    if (file.size > 8 * 1024 * 1024) throw new Error('Choose a document of at most 8 MB.');
    const bytes = new Uint8Array(await file.arrayBuffer()), pages = [];
    const add = canvas => {
      if (pages.length >= 12) throw new Error('This paper exceeds 12 pages. Shorten the paper before uploading.');
      pages.push({ FileName: `page-${pages.length + 1}.png`, FileBase64: canvas.toDataURL('image/png').split(',')[1] });
      progress(`Prepared ${pages.length} page(s)…`);
    };
    if (/\.pdf$/i.test(file.name)) {
      const pdfjs = await import('/vendor/exam-documents/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/exam-documents/pdf.worker.min.mjs';
      const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: true });
      try {
        const pdf = await task.promise;
        if (pdf.numPages > 12) throw new Error('This paper exceeds 12 pages.');
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i), first = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: Math.min(2, 1800 / first.width) });
          if (viewport.height > 5000) throw new Error('A page is too tall. Use standard page sizes.');
          const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise; add(canvas); page.cleanup();
        }
      } finally { await task.destroy(); }
    } else {
      await script('jszip.min.js'); await Promise.all([script('docx-preview.min.js'), script('html2canvas.min.js')]);
      const zip = await JSZip.loadAsync(bytes);
      if (!zip.file('word/document.xml')) throw new Error('This is not a valid Word .docx document.');
      // Bound expanded inputs and remove external relationships before rendering.
      const entries = Object.values(zip.files);
      if (entries.length > 1500 || entries.reduce((n, item) => n + (item._data?.uncompressedSize || 0), 0) > 40 * 1024 * 1024) throw new Error('The expanded Word document is too large. Export it as PDF.');
      for (const entry of entries.filter(item => item.name.endsWith('.rels'))) {
        const xml = new DOMParser().parseFromString(await entry.async('string'), 'application/xml');
        xml.querySelectorAll('Relationship[TargetMode="External"]').forEach(node => node.remove());
        zip.file(entry.name, new XMLSerializer().serializeToString(xml));
      }
      const host = document.createElement('div'); host.className = 'word-render-host';
      host.style.cssText = 'position:absolute;left:-12000px;top:0;width:1000px;background:white;'; document.body.append(host);
      try {
        const nonce = document.querySelector('meta[name="exam-style-nonce"]')?.content || '';
        const createNode = spec => { const node = docx.defaultOptions.h(spec); if (node.nodeName === 'STYLE' && nonce) node.nonce = nonce; return node; };
        await docx.renderAsync(await zip.generateAsync({ type: 'arraybuffer' }), host, null, { h: createNode, useBase64URL: true, renderAltChunks: false, renderComments: false, ignoreLastRenderedPageBreak: false });
        host.querySelectorAll('a').forEach(node => node.removeAttribute('href'));
        await document.fonts.ready;
        for (const page of host.querySelectorAll('section.docx')) {
          const height = Math.max(page.scrollHeight, page.offsetHeight), width = Math.ceil(page.getBoundingClientRect().width);
          if (width > 1800 || height > 16000) throw new Error('The Word page is too large. Use standard page sizes or export it as PDF.');
          const canvas = await html2canvas(page, { scale: 1.5, width, height, backgroundColor: '#fff', logging: false, useCORS: false, allowTaint: false,
            onclone: copy => { if (nonce) copy.querySelectorAll('style').forEach(style => { style.nonce = nonce; style.textContent = style.textContent; }); } });
          // Word files without saved page-break hints can contain a long section.
          const slice = Math.max(1, Math.ceil(page.offsetHeight * 1.5));
          for (let y = 0; y < canvas.height; y += slice) {
            const part = document.createElement('canvas'); part.width = canvas.width; part.height = Math.min(slice, canvas.height - y);
            part.getContext('2d').drawImage(canvas, 0, y, canvas.width, part.height, 0, 0, canvas.width, part.height); add(part);
          }
        }
      } finally { host.remove(); }
    }
    if (!pages.length) throw new Error('No readable pages were found. Export the document as PDF and retry.');
    if (pages.reduce((n, p) => n + p.FileBase64.length * .75, bytes.length) > 32 * 1024 * 1024) throw new Error('The paper preview exceeds 32 MB. Reduce large pictures and retry.');
    return { Source: { FileName: file.name, FileBase64: encoded(bytes) }, Pages: pages };
  }
  window.DynamaxExamDocumentUpload = { convert };
})();
