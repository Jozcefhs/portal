export function printCustomerDocument(title, lines) {
  const popup = window.open('', '_blank', 'width=800,height=720');
  if (!popup) throw Error('Allow the print window to open in this browser.');
  popup.opener = null;
  const doc = popup.document;
  doc.title = title;
  const heading = doc.createElement('h1');
  heading.textContent = title;
  doc.body.append(heading);
  for (const line of lines.filter(Boolean)) {
    const p = doc.createElement('p');
    p.textContent = line;
    doc.body.append(p);
  }
  doc.body.style.cssText = 'max-width:46rem;margin:2rem auto;font:16px/1.5 system-ui;color:#182333';
  popup.focus();
  popup.print();
}
