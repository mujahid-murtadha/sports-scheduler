# مولّد رسومات المرافق: ملعب بمنظور حقيقي (كاميرا مرتفعة) مع العناصر القائمة والظلال والإضاءة
# الاستخدام: python3 tools/draw-facilities.py public/art
import math, sys, os
OUT = sys.argv[1]
W, H = 480, 270

class Cam:
    def __init__(self, L, Wd, pitch=36, dist=0.8, height=0.72, side=0.0):
        th = math.radians(pitch)
        self.c, self.s = math.cos(th), math.sin(th)
        self.cx, self.h, self.dz = side * L, Wd * height, Wd / 2 + Wd * dist
        self.pts = []
    def raw(self, X, Y, Z):
        x = X - self.cx; y = Y - self.h; z = Z + self.dz
        yc = y * self.c + z * self.s
        zc = -y * self.s + z * self.c
        return (x / zc, -yc / zc)
    def fit(self, box_pts, mx=-0.02, mb=-0.04, top=0.2):
        # الملعب يملأ الإطار: يُسمح بتجاوز الحافتين الجانبيتين والسفلية قليلاً
        ps = [self.raw(*p) for p in box_pts]
        xs = [p[0] for p in ps]; ys = [p[1] for p in ps]
        w = max(xs) - min(xs); h = max(ys) - min(ys)
        self.k = min(W * (1 - 2 * mx) / w, H * (1 - mb - top) / h)
        self.ox = W / 2 - (min(xs) + max(xs)) / 2 * self.k
        self.oy = H * (1 - mb) - max(ys) * self.k
    def P(self, X, Y, Z):
        x, y = self.raw(X, Y, Z)
        return (self.ox + x * self.k, self.oy + y * self.k)

def fmt(p): return f"{p[0]:.1f},{p[1]:.1f}"
def poly(cam, pts, **a): return f'<polygon points="{" ".join(fmt(cam.P(*p)) for p in pts)}" {attrs(a)}/>'
def line(cam, pts, **a): return f'<polyline points="{" ".join(fmt(cam.P(*p)) for p in pts)}" fill="none" {attrs(a)}/>'
def attrs(a): return " ".join(f'{k.replace("_","-")}="{v}"' for k, v in a.items())
def ground_rect(x0, z0, x1, z1): return [(x0,0,z0),(x1,0,z0),(x1,0,z1),(x0,0,z1)]
def arc(cx, cz, r, a0, a1, n=40, y=0):
    return [(cx + r*math.cos(math.radians(a0 + (a1-a0)*i/n)), y, cz + r*math.sin(math.radians(a0 + (a1-a0)*i/n))) for i in range(n+1)]
def shadow(cam, x, z, rx, rz, op=.35):
    pts = [(x + rx*math.cos(t), 0, z + rz*math.sin(t)) for t in [i*math.pi/18 for i in range(37)]]
    return poly(cam, pts, fill="#000", fill_opacity=op, filter="url(#soft)")

LINE = dict(stroke="#F5F8F4", stroke_width="1.5", stroke_opacity=".92", stroke_linejoin="round")

def defs(sky_top, sky_bot, floor_glow):
    return f'''<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{sky_top}"/><stop offset="1" stop-color="{sky_bot}"/></linearGradient>
  <radialGradient id="spot" cx="50%" cy="58%" r="62%"><stop offset="0" stop-color="#fff" stop-opacity="{floor_glow}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <radialGradient id="vig" cx="50%" cy="55%" r="75%"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></radialGradient>
  <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2"/></filter>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
</defs>'''

def frame(body, d):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid slice">{d}{body}<rect width="{W}" height="{H}" fill="url(#spot)"/><rect width="{W}" height="{H}" fill="url(#vig)"/></svg>'

def indoor_backdrop(cam, L, Wd, m, wall, band, floor):
    # جدار الصالة خلف الطرف البعيد، وشريط إضاءة سقفي
    far = cam.P(0, 0, Wd/2 + m)[1]
    s = f'<rect width="{W}" height="{H}" fill="{floor}"/><rect width="{W}" height="{far+2:.1f}" fill="url(#sky)"/>'
    s += f'<rect y="{far*0.16:.1f}" width="{W}" height="{far*0.05:.1f}" fill="{band}" opacity=".22"/>'
    for i in range(6):
        x = W*(i+0.5)/6
        s += f'<ellipse cx="{x:.1f}" cy="{far*0.185:.1f}" rx="18" ry="3" fill="{band}" opacity=".85"/><ellipse cx="{x:.1f}" cy="{far*0.2:.1f}" rx="40" ry="14" fill="{band}" opacity=".18" filter="url(#glow)"/>'
    # مدرّج مختصر على الجدار
    for i in range(4):
        y = far - (i+1) * far*0.11
        s += f'<rect y="{y:.1f}" width="{W}" height="{far*0.05:.1f}" fill="{wall}" opacity="{.5 - i*.1:.2f}"/>'
    return s

def lamps(cam, xs, y_top, n=4):
    s = ""
    for x in xs:
        s += f'<circle cx="{x}" cy="{y_top}" r="26" fill="#FFF3C8" opacity=".55" filter="url(#glow)"/>'
        s += f'<rect x="{x-14}" y="{y_top-6}" width="28" height="12" rx="2" fill="#26313F"/>'
        for i in range(n):
            s += f'<circle cx="{x-9+i*6}" cy="{y_top}" r="2.2" fill="#FFF8DC"/>'
    return s

def goal(cam, x, half, h, depth, sgn):
    # مرمى: قائمان وعارضة وشبكة
    xb = x + sgn*depth
    s = shadow(cam, x + sgn*depth/2, 0, depth*0.7, half*1.05, .3)
    net = "#E8EEF2"
    for i in range(7):
        z = -half + 2*half*i/6
        s += line(cam, [(x, h, z), (xb, h*0.7, z), (xb, 0, z)], stroke=net, stroke_width=".6", stroke_opacity=".55")
    for j in range(5):
        t = j/4
        s += line(cam, [(x + sgn*depth*t, h - h*0.3*t, -half), (x + sgn*depth*t, h - h*0.3*t, half)], stroke=net, stroke_width=".6", stroke_opacity=".5")
        s += line(cam, [(xb, h*0.7*t, -half), (xb, h*0.7*t, half)], stroke=net, stroke_width=".6", stroke_opacity=".45")
    s += line(cam, [(x, 0, -half), (x, h, -half), (x, h, half), (x, 0, half)], stroke="#FFFFFF", stroke_width="2.4", stroke_linecap="round")
    return s

def football(training=False):
    L, Wd, m = 105, 68, 7
    cam = Cam(L, Wd, pitch=34, dist=0.75, height=0.62)
    cam.fit(ground_rect(-L/2-m, -Wd/2-m, L/2+m, Wd/2+m), top=0.22)
    s = f'<rect width="{W}" height="{H}" fill="#164F2D"/>'
    far = cam.P(0, 0, Wd/2+m)[1]
    s += f'<rect width="{W}" height="{far+1:.1f}" fill="url(#sky)"/>'
    if training:
        # ملعب التدريب: سياج شبكي وأعمدة إضاءة بدل المدرّجات
        s += f'<rect y="{far-24:.1f}" width="{W}" height="25" fill="#122431" opacity=".9"/>'
        for i in range(int(W/6)):
            s += f'<rect x="{i*6}" y="{far-24:.1f}" width=".7" height="25" fill="#2A4152"/>'
        s += f'<rect y="{far-24:.1f}" width="{W}" height="1.2" fill="#3A5466"/>'
        for x in (40, 170, W-170, W-40):
            s += f'<rect x="{x-1.2}" y="{far-70:.1f}" width="2.4" height="70" fill="#2B3644"/>'
        s += lamps(cam, [40, 170, W-170, W-40], far-72, 2)
    else:
        # المدرّجات خلف الملعب
        s += f'<polygon points="0,{far-34:.1f} {W},{far-34:.1f} {W},{far+1:.1f} 0,{far+1:.1f}" fill="#101C2B"/>'
        for i in range(5):
            y = far - 32 + i*6.5
            s += f'<rect y="{y:.1f}" width="{W}" height="2" fill="#1B2A3D" opacity=".9"/>'
        s += lamps(cam, [70, W-70], far-46)
    s += poly(cam, ground_rect(-L/2-m, -Wd/2-m, L/2+m, Wd/2+m), fill="#1C6A3A")
    n = 14
    for i in range(n):
        x0 = -L/2 - m + (L+2*m)*i/n; x1 = -L/2 - m + (L+2*m)*(i+1)/n
        s += poly(cam, ground_rect(x0, -Wd/2-m, x1, Wd/2+m), fill=("#2B8A52" if i % 2 else "#23794A") if training else ("#2E9156" if i % 2 else "#278449"))
    hw, d = Wd/2, L/2
    s += line(cam, [(-d,0,-hw),(d,0,-hw),(d,0,hw),(-d,0,hw),(-d,0,-hw)], **LINE)
    s += line(cam, [(0,0,-hw),(0,0,hw)], **LINE)
    s += line(cam, arc(0,0,9.15,0,360,64), **LINE)
    for sg in (-1, 1):
        bx = sg*d
        s += line(cam, [(bx,0,-20.16),(bx-sg*16.5,0,-20.16),(bx-sg*16.5,0,20.16),(bx,0,20.16)], **LINE)
        s += line(cam, [(bx,0,-9.16),(bx-sg*5.5,0,-9.16),(bx-sg*5.5,0,9.16),(bx,0,9.16)], **LINE)
        a = math.degrees(math.acos(5.5/9.15))
        cx = bx - sg*11
        s += line(cam, arc(cx,0,9.15, (180-a) if sg>0 else -a, (180+a) if sg>0 else a, 24), **LINE)
        s += poly(cam, arc(cx,0,0.6,0,360,12), fill="#fff")
    s += poly(cam, arc(0,0,0.7,0,360,12), fill="#fff")
    s += goal(cam, -d, 3.66*1.6, 2.44*2.4, 2.4*1.8, -1) + goal(cam, d, 3.66*1.6, 2.44*2.4, 2.4*1.8, 1)
    return frame(s, defs("#07111E", "#14283D", .22))

def basketball():
    L, Wd, m = 28, 15, 2.4
    cam = Cam(L, Wd, pitch=36, dist=0.8, height=0.7)
    cam.fit(ground_rect(-L/2-m, -Wd/2-m, L/2+m, Wd/2+m), top=0.2)
    s = indoor_backdrop(cam, L, Wd, m, "#3B2A1E", "#FFE9C2", "#7A4E2A")
    s += poly(cam, ground_rect(-L/2-m, -Wd/2-m, L/2+m, Wd/2+m), fill="#B9763C")
    s += poly(cam, ground_rect(-L/2, -Wd/2, L/2, Wd/2), fill="#D99A5B")
    for i in range(1, 30):
        z = -Wd/2 - m + (Wd+2*m)*i/30
        s += line(cam, [(-L/2-m,0,z),(L/2+m,0,z)], stroke="#7A4A22", stroke_width=".5", stroke_opacity=".22")
    hw, d = Wd/2, L/2
    for sg in (-1, 1):
        bx = sg*d
        s += poly(cam, ground_rect(min(bx, bx-sg*5.8), -2.45, max(bx, bx-sg*5.8), 2.45), fill="#B4532A", fill_opacity=".9")
    s += poly(cam, arc(0,0,1.8,0,360,40), fill="#B4532A", fill_opacity=".9")
    s += line(cam, [(-d,0,-hw),(d,0,-hw),(d,0,hw),(-d,0,hw),(-d,0,-hw)], **LINE)
    s += line(cam, [(0,0,-hw),(0,0,hw)], **LINE)
    s += line(cam, arc(0,0,1.8,0,360,40), **LINE)
    for sg in (-1, 1):
        bx = sg*d; hx = bx - sg*1.575
        s += line(cam, [(bx,0,-2.45),(bx-sg*5.8,0,-2.45),(bx-sg*5.8,0,2.45),(bx,0,2.45)], **LINE)
        fx = bx - sg*5.8
        s += line(cam, arc(fx,0,1.8,-90,90,24) if sg>0 else arc(fx,0,1.8,90,270,24), **LINE)
        a = math.degrees(math.asin(6.6/6.75))
        pts = [(bx,0,-6.6*sg),(hx - sg*math.sqrt(6.75**2-6.6**2),0,-6.6*sg)]
        pts = [(bx,0,-6.6),(hx - sg*1.414,0,-6.6)] + (arc(hx,0,6.75, 180+a, 180-a, 40) if sg>0 else arc(hx,0,6.75,-a,a,40)) + [(hx - sg*1.414,0,6.6),(bx,0,6.6)]
        s += line(cam, pts, **LINE)
    # السلتان: عمود وذراع ولوحة وحلقة
    for sg in (-1, 1):
        bx = sg*d; px = bx + sg*1.0; bbx = bx - sg*1.2; hx = bx - sg*1.9
        s += shadow(cam, px, 0, 0.9, 0.9, .35)
        s += line(cam, [(px,0,0),(px,4.2,0),(bbx,4.2,0)], stroke="#2A2F38", stroke_width="3.2", stroke_linecap="round")
        s += poly(cam, [(bbx,3.35,-1.25),(bbx,3.35,1.25),(bbx,4.75,1.25),(bbx,4.75,-1.25)], fill="#F4F6F8", fill_opacity=".92", stroke="#1E2530", stroke_width="1.2")
        s += poly(cam, [(bbx,3.5,-0.42),(bbx,3.5,0.42),(bbx,4.05,0.42),(bbx,4.05,-0.42)], fill="none", stroke="#C0392B", stroke_width="1")
        s += line(cam, arc(hx,0,0.34,0,360,20,y=3.5), stroke="#E4572E", stroke_width="2")
        s += line(cam, [(hx-0.34,3.5,0),(hx-0.2,2.95,0)], stroke="#fff", stroke_width=".6", stroke_opacity=".8")
        s += line(cam, [(hx+0.34,3.5,0),(hx+0.2,2.95,0)], stroke="#fff", stroke_width=".6", stroke_opacity=".8")
    return frame(s, defs("#2A1E16", "#5A4231", .26))

def net_between(cam, x, z0, z1, ylo, yhi, posts_h, band="#FFFFFF"):
    s = ""
    for zp in (z0-0.6, z1+0.6):
        s += shadow(cam, x, zp, 0.35, 0.35, .35)
        s += line(cam, [(x,0,zp),(x,posts_h,zp)], stroke="#2B3442", stroke_width="2.6", stroke_linecap="round")
    s += poly(cam, [(x,ylo,z0),(x,ylo,z1),(x,yhi,z1),(x,yhi,z0)], fill="#0D1520", fill_opacity=".28")
    n = 26
    for i in range(n+1):
        z = z0 + (z1-z0)*i/n
        s += line(cam, [(x,ylo,z),(x,yhi,z)], stroke="#E9EEF3", stroke_width=".45", stroke_opacity=".6")
    for j in range(5):
        y = ylo + (yhi-ylo)*j/4
        s += line(cam, [(x,y,z0),(x,y,z1)], stroke="#E9EEF3", stroke_width=".45", stroke_opacity=".6")
    s += line(cam, [(x,yhi,z0-0.6),(x,yhi,z1+0.6)], stroke=band, stroke_width="2.2")
    return s

def cross_net(cam, z, x0, x1, ylo, yhi, posts_h):
    s = ""
    for xp in (x0-0.6, x1+0.6):
        s += shadow(cam, xp, z, 0.35, 0.35, .35)
        s += line(cam, [(xp,0,z),(xp,posts_h,z)], stroke="#2B3442", stroke_width="2.6", stroke_linecap="round")
    s += poly(cam, [(x0,ylo,z),(x1,ylo,z),(x1,yhi,z),(x0,yhi,z)], fill="#0D1520", fill_opacity=".3")
    n = 36
    for i in range(n+1):
        x = x0 + (x1-x0)*i/n
        s += line(cam, [(x,ylo,z),(x,yhi,z)], stroke="#E9EEF3", stroke_width=".45", stroke_opacity=".55")
    for j in range(5):
        y = ylo + (yhi-ylo)*j/4
        s += line(cam, [(x0,y,z),(x1,y,z)], stroke="#E9EEF3", stroke_width=".45", stroke_opacity=".55")
    s += line(cam, [(x0-0.6,yhi,z),(x1+0.6,yhi,z)], stroke="#FFFFFF", stroke_width="2.2")
    return s

def volleyball():
    L, Wd, m = 18, 9, 3        # الطول في العمق، والعرض أفقي على الشاشة
    cam = Cam(Wd, L, pitch=27, dist=0.95, height=0.5)
    cam.fit(ground_rect(-Wd/2-m, -L/2-m, Wd/2+m, L/2+m), mx=0.02, top=0.18)
    s = indoor_backdrop(cam, Wd, L, m, "#14233F", "#DDE8FF", "#173B78")
    s += poly(cam, ground_rect(-Wd/2-m, -L/2-m, Wd/2+m, L/2+m), fill="#1F4E9A")
    s += poly(cam, ground_rect(-Wd/2, -L/2, Wd/2, L/2), fill="#E07A38")
    hw, d = Wd/2, L/2
    s += line(cam, [(-hw,0,-d),(hw,0,-d),(hw,0,d),(-hw,0,d),(-hw,0,-d)], **LINE)
    s += line(cam, [(-hw,0,0),(hw,0,0)], **LINE)
    for z in (-3, 3): s += line(cam, [(-hw,0,z),(hw,0,z)], **LINE)
    s += cross_net(cam, 0, -hw-0.5, hw+0.5, 1.43, 2.43, 2.55)
    return frame(s, defs("#0E1A30", "#22375C", .22))

def tennis():
    L, Wd, m = 23.77, 10.97, 4
    cam = Cam(Wd, L, pitch=27, dist=0.95, height=0.5)
    cam.fit(ground_rect(-Wd/2-m, -L/2-m, Wd/2+m, L/2+m), mx=0.02, top=0.2)
    s = f'<rect width="{W}" height="{H}" fill="#3C5A20"/>'
    far = cam.P(0, 0, L/2+m)[1]
    s += f'<rect width="{W}" height="{far+1:.1f}" fill="url(#sky)"/>'
    s += f'<rect y="{far-20:.1f}" width="{W}" height="21" fill="#1A2B22"/>'
    for i in range(int(W/8)):
        s += f'<rect x="{i*8}" y="{far-20:.1f}" width=".6" height="21" fill="#2E4436"/>'
    s += lamps(cam, [60, W-60], far-34, 3)
    s += poly(cam, ground_rect(-Wd/2-m, -L/2-m, Wd/2+m, L/2+m), fill="#4E6E2A")
    s += poly(cam, ground_rect(-Wd/2, -L/2, Wd/2, L/2), fill="#6F9234")
    hw, sw, d = Wd/2, 8.23/2, L/2
    s += line(cam, [(-hw,0,-d),(hw,0,-d),(hw,0,d),(-hw,0,d),(-hw,0,-d)], **LINE)
    s += line(cam, [(-sw,0,-d),(-sw,0,d)], **LINE) + line(cam, [(sw,0,-d),(sw,0,d)], **LINE)
    for z in (-6.4, 6.4): s += line(cam, [(-sw,0,z),(sw,0,z)], **LINE)
    s += line(cam, [(0,0,-6.4),(0,0,6.4)], **LINE)
    s += cross_net(cam, 0, -hw-0.9, hw+0.9, 0, 1.0, 1.07)
    return frame(s, defs("#07111E", "#17283A", .2))

def handball():
    L, Wd, m = 40, 20, 3
    cam = Cam(L, Wd, pitch=39, dist=0.66, height=0.85)
    cam.fit(ground_rect(-L/2-m, -Wd/2-m, L/2+m, Wd/2+m), top=0.17)
    s = indoor_backdrop(cam, L, Wd, m, "#241A38", "#EDE3FF", "#22306A")
    s += poly(cam, ground_rect(-L/2-m, -Wd/2-m, L/2+m, Wd/2+m), fill="#2C3E86")
    s += poly(cam, ground_rect(-L/2, -Wd/2, L/2, Wd/2), fill="#3D5BB8")
    hw, d = Wd/2, L/2
    for sg in (-1, 1):
        bx = sg*d
        area = [(bx,0,-7.5)] + (arc(bx,-1.5,6,-90,-180,16)[::-1] if False else []) 
        a1 = arc(bx,-1.5,6,270,180,16) if sg>0 else arc(bx,-1.5,6,270,360,16)
        a2 = arc(bx,1.5,6,180,90,16) if sg>0 else arc(bx,1.5,6,0,90,16)
        s += poly(cam, a1 + a2, fill="#8C4CC2", fill_opacity=".85")
        s += line(cam, a1 + a2, **LINE)
        b1 = arc(bx,-1.5,9,270,180,20) if sg>0 else arc(bx,-1.5,9,270,360,20)
        b2 = arc(bx,1.5,9,180,90,20) if sg>0 else arc(bx,1.5,9,0,90,20)
        s += line(cam, [p for p in b1 + b2 if abs(p[2]) <= hw], stroke="#F5F8F4", stroke_width="1.3", stroke_dasharray="4 3", stroke_opacity=".85")
    s += line(cam, [(-d,0,-hw),(d,0,-hw),(d,0,hw),(-d,0,hw),(-d,0,-hw)], **LINE)
    s += line(cam, [(0,0,-hw),(0,0,hw)], **LINE)
    s += goal(cam, -d, 1.5, 2.0, 1.0, -1) + goal(cam, d, 1.5, 2.0, 1.0, 1)
    return frame(s, defs("#16102A", "#2E2450", .22))

os.makedirs(OUT, exist_ok=True)
for name, fn in [("football", football), ("football-2", lambda: football(True)), ("basketball", basketball), ("volleyball", volleyball), ("tennis", tennis), ("handball", handball)]:
    open(f"{OUT}/{name}.svg", "w").write(fn())
print("ok")
