"""Reader for Microsoft Comic Chat art files (.avb characters, .bgb backdrops).

Written from the loader in the Comic Chat source (avbfile.cpp). Handles the compressed v2.5 files
and the older uncompressed and RLE-compressed bitmaps.
"""
import struct, zlib, sys, os
class S:
    def __init__(s,d): s.d=d; s.p=0
    def r(s,f):
        n=struct.calcsize('<'+f); v=struct.unpack_from('<'+f,s.d,s.p); s.p+=n; return v if len(v)>1 else v[0]
    def cstr(s):
        e=s.d.index(b'\0',s.p); v=s.d[s.p:e].decode('latin1'); s.p=e+1; return v
def unrle(src,w,h,bpp):
    stride=((w*bpp+31)//32)*4; out=bytearray(stride*h); x=y=0; i=0
    def put(v):
        nonlocal x
        if y<h and x<w:
            if bpp==8: out[y*stride+x]=v
            else:
                o=y*stride+x//2
                out[o]=(out[o]&0x0f)|(v<<4) if x%2==0 else (out[o]&0xf0)|v
        x+=1
    while i+1<len(src):
        n,c=src[i],src[i+1]; i+=2
        if n:
            for k in range(n): put(c if bpp==8 else ((c>>4) if k%2==0 else (c&15)))
        elif c==0: x=0; y+=1
        elif c==1: break
        elif c==2: x+=src[i]; y+=src[i+1]; i+=2
        else:
            if bpp==8:
                for k in range(c): put(src[i+k])
                i+=c+(c&1)
            else:
                for k in range(c): b=src[i+k//2]; put((b>>4) if k%2==0 else (b&15))
                nb=(c+1)//2; i+=nb+(nb&1)
    return bytes(out)
def read_palette(s):
    n=s.r('H'); pal=[]
    for i in range(n):
        r,g,b=s.d[s.p:s.p+3]; s.p+=3; pal.append((r,g,b))
    return pal
def read_image(d, off, fmt, ptype, gpal):
    """returns (w,h,bpp,pal,rows) rows top-down list of index lists"""
    s=S(d); s.p=off
    if fmt==0:
        assert d[off:off+2]==b'BM'
        bfSize,_,_,offBits=struct.unpack_from('<IHHI',d,off+2)
        hs=struct.unpack_from('<I',d,off+14)[0]
        w,h,planes,bpp,comp,szimg,_,_,clrused,_=struct.unpack_from('<iiHHIIiiII',d,off+18)
        n=clrused or (1<<bpp if bpp<=8 else 0)
        pal=[]
        for i in range(n):
            b,g,r,_=d[off+14+hs+4*i:off+14+hs+4*i+4]; pal.append((r,g,b))
        bits=d[off+offBits:off+bfSize]
        if comp in (1,2): bits=unrle(bits,w,h,bpp)
        else: assert comp==0,comp
    else:
        if ptype==1: pal=gpal
        elif ptype==2:
            t,sz=s.r('HH'); assert t==257
            pal=read_palette(s)
        elif ptype==3: pal=[(255,255,255),(0,0,0)]
        else: pal=None
        hs=s.r('I')
        w,h,planes,bpp,comp,szimg,_,_,clrused,_=struct.unpack_from('<iiHHIIiiII',d,s.p); s.p+=hs-4
        usz,csz=s.r('II')
        bits=zlib.decompress(d[s.p:s.p+csz])
        assert len(bits)==usz
    stride=((w*bpp+31)//32)*4
    rows=[]
    for y in range(h):
        row=bits[(h-1-y)*stride:(h-y)*stride]
        if bpp==8: px=list(row[:w])
        elif bpp==24: px=[(row[3*x+2],row[3*x+1],row[3*x]) for x in range(w)]
        else:
            px=[]; per=8//bpp; m=(1<<bpp)-1
            for x in range(w):
                byte=row[x//per]; sh=8-bpp*(x%per+1); px.append((byte>>sh)&m)
        rows.append(px)
    return w,h,bpp,pal,rows
def parse(path):
    d=open(path,'rb').read(); s=S(d)
    magic,typ,ver=s.r('HHH')
    a=dict(type=typ,ver=ver,name=None,faces=[],torsos=[],bodies=[],pal=None,icon=None,adj=0,d=d)
    while True:
        tag=s.r('H'); size=0
        if tag>=256: size=s.r('H')
        if tag==6: break
        if tag==1: a['name']=s.cstr()
        elif tag in(259,260,261): a[tag]=s.cstr()
        elif tag==262: a['usage']=s.r('B')
        elif tag in(8,2): a['style' if tag==8 else 'flags']=s.r('H')
        elif tag==3: a['icon']=(s.r('I'),0,0)
        elif tag==256: a['icon']=s.r('IBB')
        elif tag==257: a['pal']=read_palette(s)
        elif tag==263: a['adj']+=s.r('i')
        elif tag in(9,12):
            n=s.r('H')
            for i in range(n):
                if tag==12: io,mo,ao,em,inten,x,y,f0,f1,f2,p0,p1,p2=s.r('IIIHBHHBBBBBB')
                else:
                    io,mo,ao,em,inten,x,y=s.r('IIIHBHH'); s.p+=16; f0=f1=f2=p0=p1=p2=0
                a['bodies'].append(dict(off=(io,mo,ao),em=em,inten=inten,x=x,y=y,fmt=(f0,f1,f2),pt=(p0,p1,p2)))
        elif tag in(4,10):
            n=s.r('H')
            for i in range(n):
                if tag==10: io,mo,ao,em,inten,cx,cy,dx,dy,x,y,f0,f1,f2,p0,p1,p2=s.r('IIIHBhhhhHHBBBBBB')
                else:
                    io,mo,ao,em,inten,cx,cy,dx,dy,x,y=s.r('IIIHBhhhhHH'); s.p+=16; f0=f1=f2=p0=p1=p2=0
                a['faces'].append(dict(off=(io,mo,ao),em=em,inten=inten,cx=cx,cy=cy,dx=dx,dy=dy,x=x,y=y,fmt=(f0,f1,f2),pt=(p0,p1,p2)))
        elif tag in(5,11):
            n=s.r('H')
            for i in range(n):
                if tag==11: io,mo,ao,em,inten,cx,cy,f0,f1,f2,p0,p1,p2=s.r('IIIHBhhBBBBBB')
                else:
                    io,mo,ao,em,inten,cx,cy=s.r('IIIHBhh'); s.p+=16; f0=f1=f2=p0=p1=p2=0
                a['torsos'].append(dict(off=(io,mo,ao),em=em,inten=inten,cx=cx,cy=cy,fmt=(f0,f1,f2),pt=(p0,p1,p2)))
        elif tag>=256: s.p+=size
        else: raise Exception('tag %d'%tag)
    return a
