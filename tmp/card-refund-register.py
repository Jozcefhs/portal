"""Generate a read-only, explicitly unposted card refund review register."""
import json
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak

ROOT = Path(__file__).resolve().parent.parent
data = json.loads((ROOT / 'tmp/card-refund-discovery.json').read_text(encoding='utf-8'))
ITEM = 'ITEM-dd89d0fc-d155-48f5-af42-be52bec32129'
VENDOR = 'VND-30ce4d88-e944-43dc-bfc8-5e574b31b439'
records = defaultdict(list)
ledger = {row['LedgerNo']: row for row in data['matchingLedger']}
earnings = {row['EntryId']: row for row in data['vendorData']['vendorEarnings']}
lots = {row['LotId']: row for row in data['vendorData']['vendorClaimLots']}
for sale in data['matchingSales']:
    items = [item for item in sale['Items'] if item.get('InventoryDocumentId') == ITEM]
    assert len(items) == 1 and items[0]['Quantity'] == 1 and items[0]['Amount'] == 3500
    assert sale['PaymentMethod'] == 'Student Wallet' and sale['PaymentStatus'] == 'Paid'
    assert sale['BranchId'] == 'main' and sale['Currency'] == 'NGN'
    entry = ledger[sale['LedgerNo']]
    assert entry['AccountRef'] == sale['CustomerRef'] and entry['Debit'] == sale['Amount'] and entry['Credit'] == 0
    owner = [row for row in sale['VendorSettlements'] if row['VendorId'] == VENDOR]
    assert len(owner) == 1
    earning, lot = earnings[owner[0]['EntryId']], lots[owner[0]['LotId']]
    assert earning['SaleNo'] == sale['SaleNo'] and earning['GrossCents'] == 350000
    assert earning['OriginalLedgerNo'] == entry['LedgerNo']
    assert lot['GrossCents'] == 350000 and lot['RefundedCents'] == 0 and lot['PaidCents'] == 0
    records[sale['CustomerRef']].append({'sale': sale, 'ledger': entry, 'lot': lot})
assert len(records) == 249 and sum(map(len, records.values())) == 255
assert not any(row['Type'] == 'Refund' for row in data['vendorData']['vendorEarnings'])
assert not any(row.get('Credit', 0) > 0 and any(word in str(row.get('Description', '')).lower() for word in ['rfid', 's70', 'refund', 'reversal']) for row in data['relatedLedger'])

font_dir = Path('C:/Windows/Fonts')
pdfmetrics.registerFont(TTFont('Register', str(font_dir / 'arial.ttf')))
pdfmetrics.registerFont(TTFont('RegisterBold', str(font_dir / 'arialbd.ttf')))
pdfmetrics.registerFontFamily('Register', normal='Register', bold='RegisterBold')
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='Title2', fontName='RegisterBold', fontSize=20, leading=24, textColor=colors.HexColor('#12364b'), spaceAfter=8))
styles.add(ParagraphStyle(name='Sub', fontName='RegisterBold', fontSize=11, leading=15, textColor=colors.HexColor('#087e83'), spaceAfter=9))
styles.add(ParagraphStyle(name='Body2', fontName='Register', fontSize=10, leading=15, spaceAfter=8))
styles.add(ParagraphStyle(name='Cell2', fontName='Register', fontSize=8, leading=10))
styles.add(ParagraphStyle(name='Head2', fontName='RegisterBold', fontSize=8, leading=10, textColor=colors.white))
styles.add(ParagraphStyle(name='Money2', parent=styles['Cell2'], alignment=TA_RIGHT))
styles.add(ParagraphStyle(name='Small2', fontName='Register', fontSize=8, leading=11, textColor=colors.HexColor('#526270'), spaceAfter=5))
def p(value, style='Cell2'):
    return Paragraph(escape(str(value)), styles[style])
def table(rows, widths, header=True):
    result = Table(rows, colWidths=widths, repeatRows=1 if header else 0, hAlign='LEFT')
    result.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#12364b') if header else colors.HexColor('#edf4f6')),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('LEFTPADDING', (0,0), (-1,-1), 6), ('RIGHTPADDING', (0,0), (-1,-1), 6),
        ('TOPPADDING', (0,0), (-1,-1), 3.5), ('BOTTOMPADDING', (0,0), (-1,-1), 3.5),
        ('ROWBACKGROUNDS', (0,1 if header else 0), (-1,-1), [colors.white, colors.HexColor('#f2f6f8')]),
        ('LINEBELOW', (0,0), (-1,0), .6, colors.HexColor('#12364b')),
        ('LINEBELOW', (0,1), (-1,-1), .3, colors.HexColor('#d9e2e7')),
    ]))
    return result

output = ROOT / 'output/pdf/nfc-card-refund-register-review.pdf'
output.parent.mkdir(parents=True, exist_ok=True)
review_time = (datetime.fromisoformat(data['readTime'].replace('Z', '+00:00')) + timedelta(hours=1)).strftime('%d %b %Y, %H:%M WAT')
doc = SimpleDocTemplate(str(output), pagesize=landscape(A4), leftMargin=15*mm, rightMargin=15*mm, topMargin=15*mm, bottomMargin=15*mm,
    title='4k RFID S70 NFC Card - Refund Review Register', author='Destiny Christian Academy')
story = [p('DESTINY CHRISTIAN ACADEMY', 'Sub'), p('NFC card refund register', 'Title2'),
         p('REVIEW COPY - NO REFUNDS POSTED', 'Sub'),
         p('Item: 4k RFID S70 NFC Card | Vendor: DMS-OS | Main Branch, Secondary', 'Body2'),
         p(f'Live records checked: {review_time}. "4k" is part of the product name; the verified price was NGN 3,500 per card.', 'Body2')]
metrics = [
    ['Verified buyers', '249 students'], ['Paid card purchases', '255 purchases / NGN 892,500'],
    ['Requested refund', 'NGN 3,500 per card purchase / NGN 892,500 total'],
    ['Confirmed scope', 'All 255 purchases selected; 6 students receive NGN 7,000 each'],
    ['Reversal status', 'Not posted - Accounts Officer approval required'],
    ['Vendor settlement', 'NGN 406,000 reserved in one unpaid request covering 116 purchases'],
]
story.append(table([[p(k), p(v)] for k,v in metrics], [60*mm, 207*mm], header=False))
story += [Spacer(1, 8*mm), p('Preservation and posting controls', 'Sub'),
    p('Keep original purchases, receipts and wallet debits. Record a separate, linked Wallet Refund credit, with a balanced vendor-liability adjustment and an audit entry. Do not create a new payment or top-up. Do not restock cards automatically.', 'Body2'),
    p('The unpaid vendor request must be flagged for reconciliation before any payout. Parents will see a posted credit in Wallet Activity; no refund is visible yet because none has been posted.', 'Body2'),
    p('The register lists each student once. Amount paid includes card purchases only, not other items bought in the same transaction. Classes are taken from the wallet purchase records. The confirmed scope covers every verified card purchase, including repeat purchases.', 'Small2'),
    PageBreak(), p('Students with two paid card purchases', 'Title2'),
    p('Both purchases are included: NGN 7,000 is due to each of these six students. All refunds remain unposted and require Accounts Officer approval.', 'Body2')]
duplicate_rows = [[p(x,'Head2') for x in ['Admission number','Student','Class at purchase','Cards','Refund due (NGN)','Reversal status']]]
for ref, entries in sorted(records.items()):
    if len(entries) > 1:
        latest = max(entries, key=lambda row: row['sale']['PaidAt'])
        duplicate_rows.append([p(ref),p(latest['sale']['CustomerName']),p(latest['ledger']['ClassName']),p(len(entries)),p(f'{len(entries)*3500:,.2f}','Money2'),p('Not posted - awaiting approval')])
story += [table(duplicate_rows, [33*mm,83*mm,32*mm,15*mm,46*mm,58*mm]), Spacer(1,8*mm),
    p('The complete student register follows. Every status is based on the read-only snapshot shown on the cover.', 'Small2'), PageBreak(),
    p('Complete paid-student register', 'Title2'), p('Amounts in NGN. Refund due is 3,500 per verified card purchase. All 255 purchases are included; no refunds have been posted.', 'Small2')]
rows = [[p(x,'Head2') for x in ['No.','Student','Admission number','Class at purchase','Qty','Card amount paid','Refund due','Reversal status']]]
for index, (ref, entries) in enumerate(sorted(records.items(), key=lambda item: (item[1][-1]['sale']['CustomerName'].casefold(), item[0])), 1):
    latest = max(entries, key=lambda row: row['sale']['PaidAt'])
    rows.append([p(index),p(latest['sale']['CustomerName']),p(ref),p(latest['ledger']['ClassName']),p(len(entries)),p(f'{len(entries)*3500:,.2f}','Money2'),p(f'{len(entries)*3500:,.2f}','Money2'),p('Not posted - awaiting approval')])
story.append(table(rows,[10*mm,66*mm,32*mm,27*mm,12*mm,34*mm,32*mm,54*mm]))
story += [Spacer(1,5*mm), p('TOTAL: 249 students | 255 cards | NGN 892,500 paid | NGN 892,500 refunds due | NGN 0 posted.', 'Body2')]
def footer(canvas, document):
    canvas.setStrokeColor(colors.HexColor('#cbd7df')); canvas.line(15*mm,12*mm,282*mm,12*mm)
    canvas.setFont('Register',7); canvas.setFillColor(colors.HexColor('#526270'))
    canvas.drawString(15*mm,8*mm,'CONFIDENTIAL - Accounts review only | 4k RFID S70 NFC Card | Unposted review')
    canvas.drawRightString(282*mm,8*mm,f'Page {document.page}')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
print(json.dumps({'output':str(output),'students':249,'purchases':255,'paid':892500,'confirmedScopeRefund':892500,'posted':0,'sourceReadTime':data['readTime']}))
