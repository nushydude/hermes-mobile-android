from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

im=Image.new('RGB',(1390,1060),'#0B1412');d=ImageDraw.Draw(im)
C={'bg':'#111D1B','surface':'#1B2B26','raised':'#263A32','text':'#F3F4EC','muted':'#A4B8AC','mint':'#B7E8CB','ink':'#1A3729','amber':'#F2CA85','red':'#FFAAA2','blue':'#B9DDF5','border':'#30473D'}
def f(n,b=False):return ImageFont.truetype('C:/Windows/Fonts/'+('segoeuib.ttf' if b else 'segoeui.ttf'),n)
def t(x,y,s,n=22,c='text',b=False):d.text((x,y),s,font=f(n,b),fill=C[c])
def box(r,c='surface',rad=22):d.rounded_rectangle(r,rad,fill=C[c])
def centre(x,y,s,n=22,c='text',b=False):t(x-d.textlength(s,font=f(n,b))/2,y,s,n,c,b)
def cross(x,y):
    d.line((x-9,y-9,x+9,y+9),fill=C['muted'],width=3);d.line((x+9,y-9,x-9,y+9),fill=C['muted'],width=3)
def header(left,title):
    box((left,130,left+420,1000),'bg',35);t(left+25,154,'9:41',16,'muted');t(left+25,215,title,29,'text',True);cross(left+383,235)
t(38,24,'HANDS-FREE · MOBILE POLISH',22,'mint',True);t(38,62,'Keep the conversation going.',32,'text',True)
header(35,'Talk in this chat');header(485,'Chat actions');header(935,'Settings')
t(60,264,'An evening catch-up',22);t(60,299,'Selected model · same reasoning',17,'muted')
box((59,350,431,405),'raised',18);box((232,354,427,401),'mint',15);t(76,367,'Review first',18,'muted');centre(330,367,'Hands-free',18,'ink',True)
d.ellipse((168,449,322,603),fill=C['raised']);d.ellipse((181,462,309,590),fill=C['mint'])
d.rounded_rectangle((234,493,256,535),10,outline=C['ink'],width=4);d.arc((225,511,265,549),0,180,fill=C['ink'],width=4);d.line((245,549,245,559),fill=C['ink'],width=4)
centre(245,638,'Listening',29,'text',True);centre(245,683,'0:08 / 1:00',21,'muted')
centre(245,735,'When you pause, I’ll send',20,'muted');centre(245,765,'your words automatically.',20,'muted')
box((61,843,429,903),'raised',20);centre(245,858,'Pause conversation',22,'mint',True)
centre(245,945,'Listen → Send → Reply → Listen',17,'muted')
t(510,272,'An evening catch-up',21,'muted')
for y,label,color,kind in [(350,'Rename','blue','pencil'),(460,'Pin','mint','pin'),(570,'Archive','amber','archive'),(705,'Delete','red','trash')]:
    box((510,y,880,y+86),'surface',22);box((525,y+16,579,y+70),'raised',17);t(598,y+27,label,24,color,True)
    x=552;cy=y+43;col=C[color]
    if kind=='pencil':d.line((x-10,cy+11,x+10,cy-10),fill=col,width=5)
    elif kind=='pin':d.polygon([(x-9,cy-12),(x+9,cy-12),(x+5,cy+1),(x+12,cy+6),(x-12,cy+6),(x-5,cy+1)],outline=col,width=3);d.line((x,cy+6,x,cy+18),fill=col,width=3)
    elif kind=='archive':d.rectangle((x-12,cy-8,x+12,cy+12),outline=col,width=3);d.line((x-15,cy-12,x+15,cy-12),fill=col,width=4)
    else:d.rectangle((x-9,cy-8,x+9,cy+13),outline=col,width=3);d.line((x-14,cy-13,x+14,cy-13),fill=col,width=3)
centre(695,866,'Tap outside or × to dismiss',18,'muted')
box((960,305,1329,413),'surface',22);t(982,327,'Notifications enabled',22,'mint',True);t(982,369,'Manage notifications  ›',19,'muted')
box((960,447,1329,566),'surface',22);t(982,469,'Reasoning and tool activity',19);t(982,516,'Hidden',19,'muted')
box((960,600,1329,736),'surface',22);t(982,622,'Background connection',21,'text',True);t(982,665,'Off   ·   While running   ·   Always',17,'muted')
t(982,852,'Hermes Mobile',22,'text',True);t(982,889,'Version 0.2.0 (2)',21,'mint');t(982,927,'Installed on this phone',17,'muted')
t(38,1024,'Proposed layout · explicit hands-free start · existing session and model settings',20,'muted')
out=Path(__file__).with_name('preview.png');im.save(out);print(out)
