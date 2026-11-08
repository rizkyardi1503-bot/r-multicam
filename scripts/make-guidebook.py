#!/usr/bin/env python3
"""Illustrated quick guide (EN + ID): the /guidebook/ pages and the same guide as PDF files.

One text source feeds both, so the website page and the PDF inside the download never disagree.

  make-guidebook.py pages            write site/guidebook/index.html and site/id/guidebook/index.html
                                     (from the Sync page shell), then run build-site.py
  make-guidebook.py images DIR       convert the panel screenshots in DIR (00-login.png, overview.png,
                                     step1.png ... step6.png, taken at 2x from the real panel) to site/media/guide/*.webp
  make-guidebook.py pdf              print both PDFs with Microsoft Edge (headless) to
                                     site/guidebook/, site/id/guidebook/ and plugin/{windows,macos}/

After a PDF change, rebuild the plugin ZIPs (build-plugin-release.py): the PDFs ship at the ZIP root.
"""
import json, pathlib, re, shutil, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
SITE = ROOT / 'site'
ORIGIN = 'https://r-multicam.pages.dev'
SLUG = 'guidebook'
DATE = '2026-11-08'
VERSION = '2.3.11.19'
PDF_NAME = 'R-Project-Multicam-AI-Guide.pdf'
ZIP_PDF = {'en': 'QUICK-GUIDE-EN.pdf', 'id': 'PANDUAN-SINGKAT-ID.pdf'}
SHOTS = ['00-login', 'overview', 'step1', 'step2', 'step3', 'step4', 'step5', 'step6']
EDGE = pathlib.Path('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')

# ------------------------------------------------------------------ text (same structure in both languages)
T = {
 'en': dict(
  home='/', p='', crumb='Illustrated quick guide',
  title='Multicam AI Quick Guide with Pictures | Premiere Pro Plugin',
  desc='See every step of R Project Multicam AI before you download: install, Analyze Music, Sync Cameras, Auto Cut, Best Drops, Random Zoom and Color LUT, shown in the real panel.',
  ogdesc='Every step of the Multicam AI panel for Premiere Pro, shown in pictures from the real plugin. Read it first, download when you are ready.',
  eyebrow=f'ILLUSTRATED GUIDE · v{VERSION}',
  h1='Multicam AI quick guide: see how it works first',
  byline='By Rizki Ardiansyah, creator of R Project Multicam AI · Updated 8 November 2026',
  lead=f'Every picture on this page comes from the real v{VERSION} plugin panel for Adobe Premiere Pro. Read the steps here first and download when you are ready. The same guide comes as a PDF inside the download.',
  pdf='Download this guide (PDF)', trial='Try free for 7 days',
  need_h='What you need',
  need=['Adobe Premiere Pro on a Windows or Mac laptop or desktop. Step 6 · Color LUT needs Premiere Pro 2026.',
        'Footage from each camera and one music file: the master track or the recording from the mixer.',
        'A free R Project account. The 7-day trial needs no payment card.'],
  a_h='Step A · Install and sign in',
  a=['Sign in on the website and download the ZIP for Windows or Mac. Close Premiere, extract the ZIP and run <strong>SETUP-WINDOWS.cmd</strong> (Windows) or <strong>Install-macOS.command</strong> (Mac).',
     'Open Premiere, choose <strong>Window → Extensions (Legacy) → R Project Multicam AI</strong> and sign in with the same account. The 7-day trial starts the first time you sign in to the plugin.'],
  a_cap='The sign-in screen in the panel. Use Continue with Google or your email and password.',
  a_alt='Multicam AI panel sign-in screen with Continue with Google and email sign-in',
  o_h='The panel: six numbered steps',
  o='Work from top to bottom. Step 1 and step 3 make the edit; steps 2, 4, 5 and 6 are optional. The 7-day trial and the lifetime license open every step.',
  o_cap='The six steps in the panel, collapsed. Click a step to open it.',
  o_alt='Multicam AI panel with six steps: Analyze Music, Sync Cameras to Music, Auto Cut Multicam, Best Drops, Random Zoom and Color LUT',
  prep='<strong>Before you start:</strong> save your project and duplicate the sequence. Put each camera on its own video track and the music on A1. For a first test, set a short In/Out range.',
  s=[
   ('Step 1 · Analyze Music',
    'Click <strong>Analyze Music</strong>. The plugin reads the tempo, beats and drops of the music on A1 and shows BPM, Drops, Energy and Drop score. Open <strong>Choose the main drops</strong> if you want to pick the main drops yourself.',
    'Step 1 reads the music on A1. Do this first.',
    'Step 1 Analyze Music with BPM, Drops, Energy and Drop score'),
   ('Step 2 · Sync Cameras to Music (beta, optional)',
    'Skip this step if your cameras are already in sync. Otherwise click <strong>1. Find camera sources</strong> and tick one bin (or one video track) per camera, then <strong>2. Analyze sync</strong> and <strong>3. Build synced sequence</strong>. The plugin builds a new synced sequence; your current sequence is not changed. Check the clips labelled [CHECK], the muted Review track and the [CLOCK] track for drones. Since v2.3.11.19, clips placed from another camera’s audio are also marked [CHECK], audio-only files are left out and network paths work.',
    'Step 2 lines up every camera, drone and FPV clip on the music in a new sequence.',
    'Step 2 Sync Cameras to Music with Find camera sources, Analyze sync and Build synced sequence'),
   ('Step 3 · Auto Cut Multicam',
    'Pick an <strong>Editing preset</strong> or set the <strong>Cut Pace</strong> (2, 4, 6 or 8 beats). Choose the <strong>Main Drop Camera</strong> and the cameras to use under <strong>Camera roles &amp; cameras used</strong>. Open <strong>Preview camera plan before applying</strong> to check the plan first. Keep <strong>Save backup copy of sequence before applying</strong> ticked, then click <strong>Run Auto Cut</strong>.',
    'Step 3 cuts between your cameras on the beat.',
    'Step 3 Auto Cut Multicam with Editing preset, Cut Pace, Main Drop Camera and Run Auto Cut'),
   ('Step 4 · Best Drops (optional)',
    'Click <strong>Find Best Drops</strong> to find the strongest drops in the music. Set how long each clip runs with <strong>Before drop</strong> and <strong>After drop</strong>, check them under <strong>Review ranked drops</strong>, then render them: Adobe Media Encoder exports short highlight clips into a Best Music Drops folder next to your project.',
    'Step 4 turns the strongest drops into short highlight clips.',
    'Step 4 Best Drops with Find Best Drops, Before drop and After drop'),
   ('Step 5 · Random Zoom (optional)',
    'After Auto Cut has finished, click <strong>Add Random Zoom</strong> to add zoom moves to the clips of the edited sequence. Set the zoom range (100–115% by default) under <strong>Zoom settings</strong>.',
    'Step 5 adds zoom moves after the cut.',
    'Step 5 Random Zoom with Add Random Zoom and Zoom settings'),
   ('Step 6 · Color LUT (new)',
    'Pick a LUT from the list or click <strong>Add .cube LUT…</strong>, set the <strong>Intensity</strong>, choose <strong>Apply to</strong> (all footage in the active sequence or the selected clips) and click <strong>Apply LUT</strong>. Run it again to change the LUT or the intensity: the same effect is updated, nothing stacks. <strong>Remove LUT</strong> deletes only the plugin’s own effect, so your own Lumetri grade stays safe. Needs Premiere Pro 2026.',
    'Step 6 puts one .cube LUT on every clip at the intensity you choose.',
    'Step 6 Color LUT with LUT list, Add .cube LUT, Intensity slider, Apply to, Apply LUT and Remove LUT'),
  ],
  safe_h='Safe for your project',
  safe=['Sync Cameras to Music builds a new sequence; your original sequence is not changed.',
        'Auto Cut saves a backup copy of the sequence before applying (on by default).',
        'Remove LUT deletes only the LUT effect the plugin added.',
        'The trial needs no card. One account is active on one device at a time.'],
  end_h='Ready to try it?',
  end='Create a free account and download on your laptop or desktop. If you keep using the plugin after the trial, the lifetime license is a one-time payment.',
  related='Related resources',
  links=[('quick-start/', 'Quick start'), ('guides/music-driven-multicam-editing/', 'Music-driven editing guide'),
         ('sync-multicam-to-music/', 'Sync multicam to music'), ('help/', 'Help center')],
  pdf_footer=f'R Project Multicam AI · quick guide · v{VERSION} · r-multicam.pages.dev',
 ),
 'id': dict(
  home='/id/', p='/id', crumb='Panduan bergambar',
  title='Panduan Singkat Multicam AI Bergambar | Plugin Premiere Pro',
  desc='Lihat setiap langkah R Project Multicam AI sebelum download: instal, Analyze Music, Sync Cameras, Auto Cut, Best Drops, Random Zoom dan Color LUT, langsung dari panel asli.',
  ogdesc='Setiap langkah panel Multicam AI untuk Premiere Pro, lengkap dengan gambar dari plugin asli. Baca dulu, download kalau sudah siap.',
  eyebrow=f'PANDUAN BERGAMBAR · v{VERSION}',
  h1='Panduan singkat Multicam AI: lihat dulu cara kerjanya',
  byline='Oleh Rizki Ardiansyah, pembuat R Project Multicam AI · Diperbarui 8 November 2026',
  lead=f'Semua gambar di halaman ini diambil dari panel plugin asli v{VERSION} untuk Adobe Premiere Pro. Baca dulu langkah-langkahnya di sini, lalu download kalau sudah siap. Panduan yang sama juga ada dalam bentuk PDF di dalam file download.',
  pdf='Download panduan ini (PDF)', trial='Coba gratis 7 hari',
  need_h='Yang kamu butuhkan',
  need=['Adobe Premiere Pro di laptop atau PC Windows atau Mac. Langkah 6 · Color LUT butuh Premiere Pro 2026.',
        'Footage dari setiap kamera dan satu file musik: lagu master atau rekaman dari mixer.',
        'Akun R Project gratis. Trial 7 hari tanpa kartu pembayaran.'],
  a_h='Langkah A · Instal dan login',
  a=['Login di website lalu download ZIP untuk Windows atau Mac. Tutup Premiere, ekstrak ZIP, lalu jalankan <strong>SETUP-WINDOWS.cmd</strong> (Windows) atau <strong>Install-macOS.command</strong> (Mac).',
     'Buka Premiere, pilih <strong>Window → Extensions (Legacy) → R Project Multicam AI</strong>, lalu login dengan akun yang sama. Trial 7 hari dimulai saat pertama kali login di plugin.'],
  a_cap='Layar login di panel. Pakai Continue with Google atau email dan password.',
  a_alt='Layar login panel Multicam AI dengan Continue with Google dan login email',
  o_h='Panel: enam langkah bernomor',
  o='Kerjakan dari atas ke bawah. Langkah 1 dan 3 yang membuat edit; langkah 2, 4, 5 dan 6 opsional. Trial 7 hari dan lisensi lifetime membuka semua langkah.',
  o_cap='Enam langkah di panel dalam keadaan tertutup. Klik sebuah langkah untuk membukanya.',
  o_alt='Panel Multicam AI dengan enam langkah: Analyze Music, Sync Cameras to Music, Auto Cut Multicam, Best Drops, Random Zoom dan Color LUT',
  prep='<strong>Sebelum mulai:</strong> simpan project dan duplikat sequence-nya. Taruh setiap kamera di video track masing-masing dan musik di A1. Untuk tes pertama, atur rentang In/Out yang pendek.',
  s=[
   ('Langkah 1 · Analyze Music',
    'Klik <strong>Analyze Music</strong>. Plugin membaca tempo, beat dan drop dari musik di A1, lalu menampilkan BPM, Drops, Energy dan Drop score. Buka <strong>Choose the main drops</strong> kalau kamu ingin memilih drop utama sendiri.',
    'Langkah 1 membaca musik di A1. Kerjakan ini dulu.',
    'Langkah 1 Analyze Music dengan BPM, Drops, Energy dan Drop score'),
   ('Langkah 2 · Sync Cameras to Music (beta, opsional)',
    'Lewati langkah ini kalau kameramu sudah sinkron. Kalau belum, klik <strong>1. Find camera sources</strong> lalu centang satu bin (atau satu video track) per kamera, kemudian <strong>2. Analyze sync</strong> dan <strong>3. Build synced sequence</strong>. Plugin membuat sequence baru yang sudah sinkron; sequence-mu yang sekarang tidak diubah. Cek klip berlabel [CHECK], track Review yang di-mute dan track [CLOCK] untuk drone. Sejak v2.3.11.19, klip yang ditempatkan lewat audio kamera lain juga diberi [CHECK], file yang hanya berisi audio dilewati, dan path jaringan bisa dipakai.',
    'Langkah 2 menyelaraskan semua klip kamera, drone dan FPV ke musik di sequence baru.',
    'Langkah 2 Sync Cameras to Music dengan Find camera sources, Analyze sync dan Build synced sequence'),
   ('Langkah 3 · Auto Cut Multicam',
    'Pilih <strong>Editing preset</strong> atau atur <strong>Cut Pace</strong> (2, 4, 6 atau 8 beat). Pilih <strong>Main Drop Camera</strong> dan kamera yang dipakai di <strong>Camera roles &amp; cameras used</strong>. Buka <strong>Preview camera plan before applying</strong> untuk mengecek rencananya dulu. Biarkan <strong>Save backup copy of sequence before applying</strong> tetap tercentang, lalu klik <strong>Run Auto Cut</strong>.',
    'Langkah 3 memotong pergantian kamera mengikuti beat.',
    'Langkah 3 Auto Cut Multicam dengan Editing preset, Cut Pace, Main Drop Camera dan Run Auto Cut'),
   ('Langkah 4 · Best Drops (opsional)',
    'Klik <strong>Find Best Drops</strong> untuk mencari drop terkuat di musik. Atur panjang tiap klip dengan <strong>Before drop</strong> dan <strong>After drop</strong>, cek hasilnya di <strong>Review ranked drops</strong>, lalu render: Adobe Media Encoder meng-export klip highlight pendek ke folder Best Music Drops di samping project kamu.',
    'Langkah 4 mengubah drop terkuat menjadi klip highlight pendek.',
    'Langkah 4 Best Drops dengan Find Best Drops, Before drop dan After drop'),
   ('Langkah 5 · Random Zoom (opsional)',
    'Setelah Auto Cut selesai, klik <strong>Add Random Zoom</strong> untuk menambahkan gerakan zoom ke klip di sequence hasil edit. Atur rentang zoom (default 100–115%) di <strong>Zoom settings</strong>.',
    'Langkah 5 menambahkan gerakan zoom setelah cut.',
    'Langkah 5 Random Zoom dengan Add Random Zoom dan Zoom settings'),
   ('Langkah 6 · Color LUT (baru)',
    'Pilih LUT dari daftar atau klik <strong>Add .cube LUT…</strong>, atur <strong>Intensity</strong>, pilih <strong>Apply to</strong> (semua footage di sequence aktif atau klip yang dipilih), lalu klik <strong>Apply LUT</strong>. Jalankan lagi untuk mengganti LUT atau intensitasnya: efek yang sama diperbarui, tidak menumpuk. <strong>Remove LUT</strong> hanya menghapus efek milik plugin, jadi grade Lumetri milikmu tetap aman. Butuh Premiere Pro 2026.',
    'Langkah 6 memasang satu LUT .cube ke semua klip dengan intensitas pilihanmu.',
    'Langkah 6 Color LUT dengan daftar LUT, Add .cube LUT, slider Intensity, Apply to, Apply LUT dan Remove LUT'),
  ],
  safe_h='Aman untuk project-mu',
  safe=['Sync Cameras to Music membuat sequence baru; sequence aslimu tidak diubah.',
        'Auto Cut menyimpan salinan backup sequence sebelum menerapkan (aktif secara default).',
        'Remove LUT hanya menghapus efek LUT yang dipasang plugin.',
        'Trial tidak butuh kartu. Satu akun aktif di satu perangkat dalam satu waktu.'],
  end_h='Siap mencoba?',
  end='Buat akun gratis lalu download di laptop atau PC. Kalau kamu lanjut memakai plugin setelah trial, lisensi lifetime cukup dibayar sekali.',
  related='Sumber terkait',
  links=[('quick-start/', 'Mulai cepat'), ('guides/music-driven-multicam-editing/', 'Panduan editing mengikuti musik'),
         ('sync-multicam-to-music/', 'Sinkron multicam ke musik'), ('help/', 'Pusat bantuan')],
  pdf_footer=f'R Project Multicam AI · panduan singkat · v{VERSION} · r-multicam.pages.dev',
 ),
}
STEP_IDS = ['step-1-analyze-music', 'step-2-sync-cameras-to-music', 'step-3-auto-cut-multicam',
            'step-4-best-drops', 'step-5-random-zoom', 'step-6-color-lut']
SHOT_SIZE = {}  # filled from the webp files: name -> (width, height) in CSS pixels


def shot_size(name):
    if name not in SHOT_SIZE:
        from PIL import Image
        w, h = Image.open(SITE / 'media' / 'guide' / f'{name}.webp').size
        SHOT_SIZE[name] = (w // 2, h // 2)
    return SHOT_SIZE[name]


def figure(name, alt, cap, src_prefix='/media/guide/', ext='webp'):
    w, h = shot_size(name)
    return (f'<figure class="guide-shot"><img src="{src_prefix}{name}.{ext}" width="{w}" height="{h}" alt="{alt}" '
            f'loading="lazy" decoding="async"><figcaption>{cap}</figcaption></figure>')


def body(c, pdf=False):
    p = c['p']
    src = '/media/guide/' if not pdf else ''
    ext = 'webp' if not pdf else 'jpg'
    fig = lambda n, a, cap: figure(n, a, cap, src, ext)
    out = []
    if not pdf:
        out.append(f'<nav aria-label="Breadcrumb"><a href="{c["home"]}">Multicam AI</a><span> / {c["crumb"]}</span></nav>')
    out.append(f'<p class="eyebrow">{c["eyebrow"]}</p><h1>{c["h1"]}</h1><p class="subtle">{c["byline"]}</p><p class="lead">{c["lead"]}</p>')
    if not pdf:
        out.append(f'<div class="actions"><a class="button" href="{p}/#pricing">{c["trial"]}</a>'
                   f'<a class="button secondary" href="{p}/{SLUG}/{PDF_NAME}" data-track="guide_opened" data-content="guidebook_pdf">{c["pdf"]}</a></div><!--rp:toc--><!--/rp:toc-->')
    out.append(f'<h2 id="what-you-need">{c["need_h"]}</h2><ul>' + ''.join(f'<li>{x}</li>' for x in c['need']) + '</ul>')
    out.append(f'<h2 id="install-and-sign-in">{c["a_h"]}</h2>' + ''.join(f'<p>{x}</p>' for x in c['a']) + fig('00-login', c['a_alt'], c['a_cap']))
    out.append(f'<h2 id="the-panel-six-steps">{c["o_h"]}</h2><p>{c["o"]}</p>' + fig('overview', c['o_alt'], c['o_cap']) +
               f'<aside class="conversion-note"><p>{c["prep"]}</p></aside>')
    for i, (h, text, cap, alt) in enumerate(c['s']):
        out.append(f'<h2 id="{STEP_IDS[i]}">{h}</h2><p>{text}</p>' + fig(f'step{i + 1}', alt, cap))
    out.append(f'<h2 id="safe-for-your-project">{c["safe_h"]}</h2><ul>' + ''.join(f'<li>{x}</li>' for x in c['safe']) + '</ul>')
    out.append(f'<h2 id="ready-to-try-it">{c["end_h"]}</h2><p>{c["end"]}</p>')
    if not pdf:
        out.append(f'<div class="actions"><a class="button" href="{p}/#pricing">{c["trial"]}</a>'
                   f'<a class="button secondary" href="{p}/{SLUG}/{PDF_NAME}" data-track="guide_opened" data-content="guidebook_pdf">{c["pdf"]}</a></div>')
        out.append(f'<nav class="actions" aria-label="{c["related"]}">' + ''.join(f'<a href="{p}/{u}">{t}</a>' for u, t in c['links']) + '</nav>')
    return ''.join(out)


# ------------------------------------------------------------------ pages
def make_pages():
    for lang, c in T.items():
        shell = SITE / ('id/' if lang == 'id' else '') / 'sync-multicam-to-music' / 'index.html'
        s = shell.read_text(encoding='utf-8')
        url = f'{ORIGIN}{c["p"]}/{SLUG}/'
        s = re.sub(r'<title>.*?</title>', lambda m: f'<title>{c["title"]}</title>', s, count=1)
        for pat, val in [(r'(<meta name="description" content=")[^"]*', c['desc']),
                         (r'(<link rel="canonical" href=")[^"]*', url),
                         (r'(<meta property="og:title" content=")[^"]*', c['title']),
                         (r'(<meta name="twitter:title" content=")[^"]*', c['title']),
                         (r'(<meta property="og:description" content=")[^"]*', c['ogdesc']),
                         (r'(<meta name="twitter:description" content=")[^"]*', c['ogdesc']),
                         (r'(<meta property="og:url" content=")[^"]*', url)]:
            s, n = re.subn(pat, lambda m: m.group(1) + val, s, count=1)
            if n != 1: sys.exit(f'{lang}: {pat} not found')
        ld = {"@context": "https://schema.org", "@graph": [
            {"@type": "BreadcrumbList", "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "R Project Multicam AI", "item": ORIGIN + c['home']},
                {"@type": "ListItem", "position": 2, "name": c['crumb'], "item": url}]},
            {"@type": "TechArticle", "headline": c['h1'], "description": c['desc'], "url": url, "inLanguage": lang,
             "dateModified": DATE, "author": {"@type": "Person", "name": "Rizki Ardiansyah", "url": ORIGIN + c['home']},
             "publisher": {"@type": "Organization", "name": "R Project", "url": ORIGIN + c['home']},
             "image": f"{ORIGIN}/media/guide/overview.webp", "mainEntityOfPage": url}]}
        s, n = re.subn(r'<script type="application/ld\+json">.*?</script>',
                       lambda m: '<script type="application/ld+json">' + json.dumps(ld, ensure_ascii=False, separators=(',', ':')) + '</script>', s, count=1, flags=re.S)
        if n != 1: sys.exit(f'{lang}: ld+json not found')
        s, n = re.subn(r'(<main id="main" class="wrap section guide-content">).*?(</main>)', lambda m: m.group(1) + body(c) + m.group(2), s, count=1, flags=re.S)
        if n != 1: sys.exit(f'{lang}: main not found')
        # The shell's language block points at the Sync page; build-site.py regenerates it for this path.
        s = s.replace('sync-multicam-to-music/', f'{SLUG}/')
        out = SITE / ('id/' if lang == 'id' else '') / SLUG / 'index.html'
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(s.encode('utf-8'))
        print('wrote', out.relative_to(ROOT))


# ------------------------------------------------------------------ images
def make_images(src_dir):
    from PIL import Image
    dst = SITE / 'media' / 'guide'
    dst.mkdir(parents=True, exist_ok=True)
    for n in SHOTS:
        im = Image.open(pathlib.Path(src_dir) / f'{n}.png').convert('RGB')
        im.save(dst / f'{n}.webp', 'WEBP', quality=82, method=6)
        print(n, im.size, (dst / f'{n}.webp').stat().st_size, 'bytes')


# ------------------------------------------------------------------ pdf
PRINT_CSS = '''
@page { size: A4; margin: 16mm 16mm 18mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; color: #15171c; font-size: 10.5pt; line-height: 1.5; }
.eyebrow { color: #4d6b00; font-weight: 700; letter-spacing: .08em; font-size: 8.5pt; margin: 0 0 4pt; }
h1 { font-size: 21pt; line-height: 1.2; margin: 0 0 6pt; }
.subtle { color: #5b6170; font-size: 9pt; margin: 0 0 8pt; }
.lead { font-size: 11.5pt; margin: 0 0 10pt; }
h2 { font-size: 14pt; margin: 16pt 0 5pt; break-after: avoid; border-top: 1px solid #dfe3ea; padding-top: 10pt; }
p, li { margin: 0 0 6pt; }
ul { padding-left: 16pt; margin: 0 0 6pt; }
.guide-shot { margin: 8pt 0 4pt; break-inside: avoid; }
.guide-shot img { display: block; width: 80mm; height: auto; border-radius: 6pt; }
.guide-shot figcaption { color: #5b6170; font-size: 8.5pt; margin-top: 3pt; }
.conversion-note { border-left: 3pt solid #9bcf00; background: #f4f8e8; padding: 6pt 9pt; margin: 8pt 0; break-inside: avoid; }
.foot { margin-top: 16pt; color: #5b6170; font-size: 8.5pt; border-top: 1px solid #dfe3ea; padding-top: 6pt; }
'''


def make_pdf():
    if not EDGE.exists(): sys.exit(f'Edge not found: {EDGE}')
    with tempfile.TemporaryDirectory() as tmp:
        tmp = pathlib.Path(tmp)
        from PIL import Image
        for n in SHOTS:  # 1.5x JPEG keeps each PDF small (2x PNG screenshots made them ~1.6 MB); printed at 80 mm wide
            im = Image.open(SITE / 'media' / 'guide' / f'{n}.webp').convert('RGB')
            im = im.resize((im.width * 3 // 4, im.height * 3 // 4), Image.LANCZOS)
            im.save(tmp / f'{n}.jpg', 'JPEG', quality=78, optimize=True, progressive=True)
        for lang, c in T.items():
            page = (f'<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><title>{c["h1"]}</title>'
                    f'<style>{PRINT_CSS}</style></head><body>{body(c, pdf=True)}<p class="foot">{c["pdf_footer"]}</p></body></html>')
            src = tmp / f'guide-{lang}.html'
            src.write_text(page, encoding='utf-8')
            pdf = tmp / f'guide-{lang}.pdf'
            subprocess.run([str(EDGE), '--headless=new', '--disable-gpu', '--no-pdf-header-footer', f'--user-data-dir={tmp / "edge"}',
                            f'--print-to-pdf={pdf}', src.as_uri()], check=True, timeout=120,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if not pdf.exists() or pdf.stat().st_size < 10000: sys.exit(f'{lang}: PDF not written')
            targets = [SITE / ('id/' if lang == 'id' else '') / SLUG / PDF_NAME,
                       ROOT / 'plugin' / 'windows' / ZIP_PDF[lang], ROOT / 'plugin' / 'macos' / ZIP_PDF[lang]]
            for t in targets:
                t.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(pdf, t)
            print(lang, pdf.stat().st_size, 'bytes ->', ', '.join(str(t.relative_to(ROOT)) for t in targets))


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'pages': make_pages()
    elif cmd == 'images': make_images(sys.argv[2])
    elif cmd == 'pdf': make_pdf()
    else: sys.exit(__doc__)
