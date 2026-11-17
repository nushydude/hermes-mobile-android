"""Render a code-drawn layout reference; no phone image or private conversation is used."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT=Path(__file__).with_name('preview.png')
im=Image.new('RGB',(1120,1140),'#0B1412');d=ImageDraw.Draw(im)
C={'bg':'#111D1B','surface':'#1B2B26','raised':'#263A32','text':'#F3F4EC','muted':'#A4B8AC','accent':'#B7E8CB','ink':'#1A3729','peach':'#EDC5A7','border':'#30473D'}
def font(n,bold=False):return ImageFont.truetype('C:/Windows/Fonts/'+('segoeuib.ttf' if bold else 'segoeui.ttf'),n)
def text(x,y,s,size=23,color='text',bold=False):d.text((x,y),s,font=font(size,bold),fill=C[color])
def center(x,y,s,size=23,color='text',bold=False):
    box=d.textbbox((0,0),s,font=font(size,bold));text(x-(box[2]-box[0])/2,y,s,size,color,bold)
def box(rect,fill='surface',radius=26,outline=None):d.rounded_rectangle(rect,radius,fill=C.get(fill,fill),outline=C.get(outline,outline) if outline else None,width=2)
def mic(cx,cy):
    d.rounded_rectangle((cx-13,cy-32,cx+13,cy+13),13,outline=C['ink'],width=5)
    d.arc((cx-24,cy-15,cx+24,cy+28),0,180,fill=C['ink'],width=5)
    d.line((cx,cy+28,cx,cy+41),fill=C['ink'],width=5);d.line((cx-15,cy+41,cx+15,cy+41),fill=C['ink'],width=5)
text(54,28,'VOICE · WARM FOREST',21,'accent',True)
text(54,61,'Voice that stays with your chat.',32,'text',True)
for left,speaking in [(45,False),(585,True)]:
    right=left+490;cx=left+245
    box((left,126,right,1082),'bg',40,'border')
    text(left+27,149,'9:41',18,'muted',True)
    box((cx-50,150,cx+50,165),'raised',8)
    text(left+31,219,'VOICE IN THIS CHAT',18,'accent',True)
    text(left+31,252,'An evening catch-up',30,'text',True)
    text(left+31,300,'Your selected model · same reasoning',19,'muted')
    box((left+26,350,right-26,959),'surface',30)
    d.ellipse((cx-91,413,cx+91,595),fill=C['raised'])
    d.ellipse((cx-73,431,cx+73,577),fill=C['accent'])
    if speaking:
        for dx in [-17,9]:box((cx+dx,474,cx+dx+9,532),'ink',3)
        center(cx,627,'Hermes is speaking',28,'text',True)
        center(cx,671,'Part 2 of 3',21,'muted')
        d.line((left+62,735,right-62,735),fill=C['border'],width=6)
        d.line((left+62,735,left+248,735),fill=C['accent'],width=6)
        d.ellipse((left+241,728,left+255,742),fill=C['accent'])
        text(left+60,754,'0:42',19,'muted');text(right-108,754,'1:18',19,'muted')
        for bx,label in [(left+45,'Replay'),(left+179,'Back 10s'),(left+313,'1.25×')]:
            box((bx,812,bx+130,875),'raised',22);center(bx+65,830,label,21,'accent',True)
        center(cx,911,'Tap the centre to pause or resume',18,'muted')
    else:
        box((cx-24,480,cx+24,528),'ink',8)
        center(cx,627,"I'm listening",28,'text',True)
        center(cx,676,'Speak naturally.',23,'muted')
        center(cx,708,'Review the words before sending.',21,'muted')
        box((left+63,790,right-63,866),'raised',25)
        center(cx,813,'Recording  0:12 / 1:00',23,'accent',True)
        center(cx,905,"Tap the centre when you're done",18,'muted')
    box((left+28,986,right-28,1048),'raised',22);center(cx,1003,'End voice',23,'text',True)
text(56,1100,'Proposed layout · illustrative states · Review → Send stays explicit',20,'muted')
im.save(OUT)
print(OUT)
