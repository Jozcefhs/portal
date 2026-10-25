"""Create small synthetic Word/PDF papers for document rendering regression checks."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from reportlab.pdfgen import canvas

folder = Path(__file__).resolve().parent.parent / 'tests' / 'fixtures'
with ZipFile(folder / 'entrance-paper.docx', 'w', ZIP_DEFLATED) as archive:
    archive.writestr('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    archive.writestr('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    archive.writestr('word/document.xml', '''<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>MATHEMATICS ENTRANCE EXAMINATION</w:t></w:r></w:p><w:p><w:r><w:t>1. What is 12 x 5?</w:t></w:r></w:p><w:p><w:r><w:t>A. 50     B. 60     C. 70     D. 80</w:t></w:r></w:p><w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>2. What is 9 + 3?</w:t></w:r></w:p><w:p><w:r><w:t>A. 8     B. 9     C. 10     D. 12</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>''')
pdf = canvas.Canvas(str(folder / 'entrance-paper.pdf'), pagesize=(595, 842), invariant=1)
for number, question, options in [(1, 'What is 12 x 5?', 'A. 50     B. 60     C. 70     D. 80'), (2, 'What is 9 + 3?', 'A. 8     B. 9     C. 10     D. 12')]:
    pdf.setFont('Helvetica-Bold', 16); pdf.drawString(55, 780, 'MATHEMATICS ENTRANCE EXAMINATION')
    pdf.setFont('Helvetica', 13); pdf.drawString(55, 730, f'{number}. {question}'); pdf.drawString(55, 700, options); pdf.showPage()
pdf.save()
