/* On-demand PDF export of the same result template used for printing. */
(() => {
  'use strict';
  let libraries;
  function script(src,ready){if(ready())return Promise.resolve();return new Promise((resolve,reject)=>{const el=document.createElement('script');el.src=src;el.onload=()=>ready()?resolve():reject(Error('PDF tools could not be loaded.'));el.onerror=()=>{el.remove();reject(Error('PDF tools could not be loaded. Check your connection and try again.'));};document.head.appendChild(el);});}
  async function load(){if(!libraries)libraries=Promise.all([script('/vendor/exam-documents/html2canvas.min.js',()=>Boolean(window.html2canvas)),script('/vendor/result-download/pdf-lib.min.js',()=>Boolean(window.PDFLib))]).catch(e=>{libraries=null;throw e;});return libraries;}
  async function download(markup,filename){
    await load();const frame=document.createElement('iframe');frame.title='Preparing result PDF';frame.setAttribute('aria-hidden','true');frame.style.cssText='position:fixed;left:-12000px;top:0;width:704px;height:1000px;border:0;pointer-events:none';
    try{
      const ready=new Promise(resolve=>frame.onload=resolve);frame.srcdoc=markup;document.body.appendChild(frame);await ready;
      const doc=frame.contentDocument,style=doc.createElement('style');style.textContent='body{margin:0!important}.report{min-width:0!important}.no-print{display:none!important}';doc.head.appendChild(style);await doc.fonts.ready;
      await Promise.all([...doc.images].map(img=>img.complete?Promise.resolve():new Promise(resolve=>{img.onload=img.onerror=resolve;setTimeout(resolve,10000);})));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const report=doc.querySelector('.report');if(!report)throw Error('The result layout could not be prepared.');
      // Preserve the browser's resolved column widths in the canvas clone, which
      // otherwise recalculates percentage colgroups and can overrun long subjects.
      for(const table of report.querySelectorAll('table')){const first=table.rows[0];if(!first)continue;const widths=[...first.cells].map(cell=>cell.getBoundingClientRect().width),width=table.getBoundingClientRect().width;let group=table.querySelector('colgroup');if(!group){group=doc.createElement('colgroup');table.prepend(group);}group.replaceChildren(...widths.map(value=>{const col=doc.createElement('col');col.style.width=value+'px';return col;}));table.style.width=width+'px';table.style.tableLayout='fixed';}
      const captureWidth=Math.ceil(Math.max(report.getBoundingClientRect().width,report.scrollWidth+4));
      // Reuse same-origin/embedded report images. Canvas never receives credentials
      // for arbitrary destinations, and no student data goes to a PDF service.
      const canvas=await window.html2canvas(report,{scale:2,backgroundColor:'#ffffff',useCORS:true,allowTaint:false,logging:false,windowWidth:704,windowHeight:Math.ceil(report.scrollHeight),width:captureWidth});
      const pdf=await window.PDFLib.PDFDocument.create();pdf.setTitle(filename.replace(/\.pdf$/i,''));pdf.setCreator('Dynamax Parent Portal');
      const pageWidth=595.28,pageHeight=841.89,margin=34.02,usableWidth=pageWidth-2*margin,pixelsPerPoint=canvas.width/usableWidth,maxHeight=Math.floor((pageHeight-2*margin)*pixelsPerPoint);
      const rect=report.getBoundingClientRect(),scale=canvas.width/captureWidth;
      const breaks=[...report.querySelectorAll('.letterhead,.title,.identity-table,.subject-table tr,.summary-table,.remarks-table,.criteria-table,.verification-table')].map(el=>Math.ceil((el.getBoundingClientRect().bottom-rect.top)*scale)).filter(y=>y>0&&y<canvas.height);
      const head=report.querySelector('.subject-table thead')?.getBoundingClientRect(),subjectTable=report.querySelector('.subject-table')?.getBoundingClientRect(),headTop=head?Math.floor((head.top-rect.top)*scale):0,headHeight=head?Math.ceil(head.height*scale):0,tableBottom=subjectTable?Math.ceil((subjectTable.bottom-rect.top)*scale):0;
      let top=0;while(top<canvas.height){const repeatHead=top>=headTop+headHeight&&top<tableBottom?headHeight:0;let bottom=Math.min(top+maxHeight-repeatHead,canvas.height);if(bottom<canvas.height){const safe=breaks.filter(y=>y>top+30&&y<=bottom);if(safe.length)bottom=Math.max(...safe);}
        const part=document.createElement('canvas');part.width=canvas.width;part.height=bottom-top+repeatHead;const context=part.getContext('2d');if(repeatHead)context.drawImage(canvas,0,headTop,canvas.width,headHeight,0,0,canvas.width,headHeight);context.drawImage(canvas,0,top,canvas.width,bottom-top,0,repeatHead,canvas.width,bottom-top);
        const png=await pdf.embedPng(part.toDataURL('image/png')),page=pdf.addPage([pageWidth,pageHeight]),height=part.height/pixelsPerPoint;page.drawImage(png,{x:margin,y:pageHeight-margin-height,width:usableWidth,height});top=bottom;part.width=part.height=0;
      }
      const bytes=await pdf.save(),url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'})),link=document.createElement('a');link.href=url;link.download=filename.replace(/[<>:"/\\|?*\x00-\x1f]/g,'-');document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);canvas.width=canvas.height=0;
    }finally{frame.remove();}
  }
  window.DynamaxAcademicResultDownload=Object.freeze({download});
})();
