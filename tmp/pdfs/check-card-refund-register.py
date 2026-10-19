from pathlib import Path
from PIL import Image, ImageOps, ImageDraw
import pdfplumber

root=Path(__file__).resolve().parent
paths=sorted(root.glob('nfc-card-refund-final-*.png'))
assert len(paths)==11
sheet=Image.new('RGB',(1800,1760),'#dce4e9')
draw=ImageDraw.Draw(sheet)
for i,path in enumerate(paths):
    image=Image.open(path).convert('RGB')
    image.thumbnail((590,415))
    x,y=(i%3)*600,(i//3)*440
    draw.text((x+10,y+6),f'PAGE {i+1}',fill='black')
    sheet.paste(image,(x+5,y+22))
sheet.save(root/'nfc-card-refund-posted-contact-sheet.png')
with pdfplumber.open(root.parent.parent/'output/pdf/nfc-card-refund-register-posted.pdf') as pdf:
    for i,page in enumerate(pdf.pages,1):
        words=page.extract_words()
        outside=[w['text'] for w in words if w['x0']<40 or w['x1']>802 or w['top']<9 or w['bottom']>575]
        assert not outside,(i,outside)
        print(f'Page {i}: {len(words)} words; all within page margins')
