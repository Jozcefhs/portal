(() => {
  'use strict';
  async function append(holder, paper, label = 'Question paper') {
    if (paper.MimeType !== 'application/pdf') {
      if (!['image/png', 'image/jpeg'].includes(paper.MimeType)) throw new Error('Unsupported question-paper format.');
      const image = document.createElement('img'); image.alt = label;
      image.src = `data:${paper.MimeType};base64,${paper.FileBase64}`; holder.append(image); return;
    }
    const pdfjs = await import('/vendor/exam-documents/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/exam-documents/pdf.worker.min.mjs';
    const task = pdfjs.getDocument({ data: Uint8Array.from(atob(paper.FileBase64), c => c.charCodeAt(0)), isEvalSupported: false, useSystemFonts: true });
    const prepared = document.createDocumentFragment();
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 100) throw new Error('This paper exceeds 100 pages. Ask the school to shorten it.');
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number), base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2, 1600 / base.width, 4000 / base.height) });
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        const image = document.createElement('img'); image.alt = `${label}, page ${number}`; image.src = canvas.toDataURL('image/png'); prepared.append(image);
        page.cleanup(); canvas.width = canvas.height = 0;
      }
      holder.append(prepared);
    } finally { await task.destroy(); }
  }
  window.DynamaxExamPaperViewer = { append };
})();
