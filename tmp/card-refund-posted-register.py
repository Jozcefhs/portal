"""Create the final register from the independently verified, read-only live snapshot."""
import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
data = json.loads((ROOT / 'tmp/card-refund-verification.json').read_text(encoding='utf-8'))
s, batch = data['summary'], data['batch']
assert s['allPassed'] and all(s['checks'].values())
assert batch['Status'] == 'Completed' and batch['PostedCount'] == 255 and batch['PostedCents'] == 89250000
buyers = defaultdict(list)
for row in batch['Rows']:
    assert row['Status'] == 'Posted' and row['Amount'] == 3500
    buyers[row['AdmissionNo']].append(row)
assert len(buyers) == 249 and sum(len(v) for v in buyers.values()) == 255
assert sum(len(v) == 2 for v in buyers.values()) == 6

font_dir = Path('C:/Windows/Fonts')
pdfmetrics.registerFont(TTFont('Register', str(font_dir / 'arial.ttf')))
pdfmetrics.registerFont(TTFont('RegisterBold', str(font_dir / 'arialbd.ttf')))
pdfmetrics.registerFontFamily('Register', normal='Register', bold='RegisterBold')
navy, teal, muted = map(colors.HexColor, ['#14364b', '#087c72', '#516575'])
styles = {
    'title': ParagraphStyle('title', fontName='RegisterBold', fontSize=23, leading=28, textColor=navy, spaceAfter=10),
    'eyebrow': ParagraphStyle('eyebrow', fontName='RegisterBold', fontSize=10, leading=14, textColor=teal, spaceAfter=7),
    'sub': ParagraphStyle('sub', fontName='RegisterBold', fontSize=12, leading=16, textColor=navy, spaceAfter=6),
    'body': ParagraphStyle('body', fontName='Register', fontSize=10, leading=14, textColor=navy, spaceAfter=6),
    'small': ParagraphStyle('small', fontName='Register', fontSize=8, leading=11, textColor=muted, spaceAfter=4),
    'cell': ParagraphStyle('cell', fontName='Register', fontSize=8.2, leading=10.5, textColor=navy),
    'head': ParagraphStyle('head', fontName='RegisterBold', fontSize=8.2, leading=10.5, textColor=colors.white),
    'money': ParagraphStyle('money', fontName='Register', fontSize=8.2, leading=10.5, textColor=navy, alignment=TA_RIGHT),
    'status': ParagraphStyle('status', fontName='RegisterBold', fontSize=8.2, leading=10.5, textColor=teal),
}
def p(text, style='cell'):
    return Paragraph(escape(str(text)), styles[style])

def wat(value, short=False):
    value = datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(timezone(timedelta(hours=1)))
    return value.strftime('%H:%M:%S') if short else value.strftime('%d %b %Y, %H:%M:%S WAT')

def table(rows, widths, header=True):
    t = Table(rows, colWidths=[w*mm for w in widths], repeatRows=1 if header else 0, hAlign='LEFT')
    t.setStyle(TableStyle([
        ('BACKGROUND',(0,0),(-1,0),navy if header else colors.HexColor('#e9f2f4')),
        ('VALIGN',(0,0),(-1,-1),'TOP'),
        ('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),
        ('TOPPADDING',(0,0),(-1,-1),3.5),('BOTTOMPADDING',(0,0),(-1,-1),3.5),
        ('ROWBACKGROUNDS',(0,1 if header else 0),(-1,-1),[colors.white,colors.HexColor('#f1f5f7')]),
        ('LINEBELOW',(0,0),(-1,-1),0.3,colors.HexColor('#d7e1e8')),
    ]))
    return t

output = ROOT / 'output/pdf/nfc-card-refund-register-posted.pdf'
output.parent.mkdir(parents=True, exist_ok=True)
doc = SimpleDocTemplate(str(output), pagesize=landscape(A4), leftMargin=15*mm, rightMargin=15*mm,
    topMargin=16*mm, bottomMargin=16*mm, title='NFC Card Refund Register - Posted and Reconciled', author='Destiny Christian Academy')
story = [p('DESTINY CHRISTIAN ACADEMY  /  MAIN BRANCH', 'eyebrow'),
    p('NFC card refund register', 'title'),
    p('POSTED AND RECONCILED', 'eyebrow'),
    p('4k RFID S70 NFC Card | DMS-OS | Secondary | Currency: NGN', 'body'),
    p(f"Batch: {batch['BatchId']} | Live verification: {wat(s['readTime'])}", 'small'),
    Spacer(1, 3*mm)]
metrics = [
    ['Students refunded', '249 students / 255 paid card purchases'],
    ['Amount credited to wallets', 'NGN 892,500.00 - all 255 refunds posted'],
    ['Refund basis', 'NGN 3,500 per card purchase; six students received NGN 7,000 each'],
    ['Approved by', f"{batch['ApprovedBy']} (Accounts Officer) | {wat(batch['ApprovedAt'])}"],
    ['Posting completed', wat(batch['CompletedAt'])],
    ['Outstanding / failed refunds', '0 / 0 - no duplicate refund credits found'],
]
story += [table([[p(k),p(v)] for k,v in metrics],[59,208],False), Spacer(1,5*mm),
    p('Original records preserved', 'sub'),
    p('All 255 original purchases and wallet purchase debits remain unchanged, including their source evidence and document revisions. All 552 existing payment records checked for the affected students, including receipt fields, are unchanged from immediately before approval.', 'body'),
    p('Each refund has one linked NGN 3,500 wallet credit, a balanced accounting journal, a vendor refund record and an audit entry. The refunds are separate credits; they do not overwrite the original payments or receipts.', 'body'),
    p('Vendor reconciliation', 'sub'),
    p('The unpaid NGN 406,000 request was cancelled for refund. Its 116 allocations, original amount and prior history are retained, with the cancellation appended. DMS-OS payable: NGN 0.00; reserved: NGN 0.00; paid out: NGN 0.00. The batch settlement hold is released.', 'body'),
    p(f"Request: {s['vendor']['requestId']}", 'small'),
    p('This is a student wallet refund, not a bank transfer. Cards were not restocked. Parent Wallet Activity includes the linked credit labelled "Refund: 4k RFID S70 NFC Card - sales approval under review". Current wallet balances may also reflect other transactions.', 'small'),
    PageBreak(), p('Complete student reversal register', 'title'),
    p('One row per student. All card purchases are included. Amounts are NGN; posting times below are WAT on 16 October 2026. "Posted" means every linked card purchase in that row was refunded.', 'small')]
columns = ['No.','Student','Admission number','Cards','Amount paid\n(NGN)','Refund posted\n(NGN)','Reversal status','Last posted\n(WAT)']
rows = [[p(v,'head') for v in columns]]
ordered = sorted(buyers.items(), key=lambda x:(x[1][0]['StudentName'].casefold(),x[0]))
for i,(ref,entries) in enumerate(ordered,1):
    total = sum(row['Amount'] for row in entries)
    latest = max(row['PostedAt'] for row in entries)
    rows.append([p(i),p(entries[0]['StudentName']),p(ref),p(len(entries)),p(f'{total:,.2f}','money'),
        p(f'{total:,.2f}','money'),p('Posted','status'),p(wat(latest,True))])
story += [table(rows,[10,77,34,13,35,35,31,32]),Spacer(1,4*mm),
    p('TOTAL: 249 students | 255 cards | NGN 892,500.00 paid | NGN 892,500.00 refunded | All posted', 'body')]

def footer(canvas, document):
    canvas.setStrokeColor(colors.HexColor('#cad7df'))
    canvas.line(15*mm,12*mm,282*mm,12*mm)
    canvas.setFont('Register',7)
    canvas.setFillColor(muted)
    canvas.drawString(15*mm,8*mm,'CONFIDENTIAL - Accounts register | NFC-S70-20261016-v1 | Verified posted')
    canvas.drawRightString(282*mm,8*mm,f'Page {document.page}')
    if document.page>1:
        canvas.setFont('RegisterBold',7)
        canvas.drawString(15*mm,203*mm,'DESTINY CHRISTIAN ACADEMY / NFC CARD REFUND REGISTER')
        canvas.drawRightString(282*mm,203*mm,'POSTED / 16 OCTOBER 2026')

doc.build(story,onFirstPage=footer,onLaterPages=footer)
pdf = PdfReader(str(output))
text = '\n'.join(page.extract_text() for page in pdf.pages)
for ref in buyers:
    assert text.count(ref)==1, f'Missing or repeated admission number: {ref}'
assert '892,500.00' in text and text.count('Posted')==250
print(json.dumps({'output':str(output),'pages':len(pdf.pages),'students':len(buyers),'purchases':255,'posted':892500,'allAdmissionNumbersVerified':True}))
