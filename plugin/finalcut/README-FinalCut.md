# R Project Multicam AI for Final Cut Pro & DaVinci Resolve (macOS + Windows) · v1.2.0

## Bahasa Indonesia

**Baru di v1.2: dari set ke Reels.** Pilih musik + satu folder per kamera, klik **Find drops**, pilih drop, lalu
**Export**: MP4 siap posting (9:16, 4:5 atau 16:9; 15/30/60 detik; zoom saat drop; LUT .cube). Juga **Full set**,
**Final Cut XML** dan **DaVinci XML** dari hasil yang sama. Terbuka di jendela sendiri (ikon R), tanpa Terminal; tutup
jendela = aplikasi berhenti. Export memakai GPU (NVIDIA, Intel, AMD, Apple) + CPU bersamaan bila ada; kalau GPU gagal,
otomatis pakai CPU.

**Yang dibutuhkan**
- Mac dengan macOS 12 atau lebih baru (Apple Silicon atau Intel).
- Final Cut Pro 10.6 atau lebih baru, atau DaVinci Resolve 18 atau lebih baru.
- Akun R Project (akun yang sama dengan plugin Premiere) dan koneksi internet untuk masuk.
- Node.js dan FFmpeg tidak perlu dipasang sendiri; installer menyiapkannya (versi resmi, dicek SHA-256).

**Pasang**
1. Ekstrak ZIP, lalu pindahkan foldernya ke folder home kamu (jangan dijalankan dari Downloads).
2. Klik kanan **Install-FinalCut.command** → **Open** → **Open**. Tidak perlu password administrator.
3. Setelah selesai, **R Project Engine for Final Cut** terbuka sendiri. Nanti bisa dibuka lagi dari folder
   **Applications** atau Desktop.

**Installer**: Windows `R-Project-Multicam-AI-Setup-<versi>.exe` (klik dua kali, Next, Finish). Mac
`R-Project-Multicam-AI-<versi>-Mac-AppleSilicon.zip` atau `-Mac-Intel.zip` (buka ZIP, seret aplikasi ke Applications; sudah
berisi Node.js dan FFmpeg).

**Pasang di Windows dari ZIP (DaVinci Resolve)**: ekstrak ZIP, klik dua kali **Install-Windows.bat**. Buka **R Project Multicam AI**
dari Desktop atau Start menu. Hasil edit disimpan di **Videos › R Project Multicam**. Hapus: **Uninstall-Windows.bat**.

**Pakai**
1. Buka **R Project Engine for Final Cut**. Jendela Terminal dan halaman kontrol di browser terbuka. Biarkan Terminal tetap terbuka.
2. **Masuk** dengan akun R Project (email/password atau Google). Status menampilkan sisa trial atau *Lifetime*.
   Premiere dan Final Cut di Mac yang sama dihitung sebagai satu perangkat.
3. Di Final Cut / DaVinci: taruh musik master dan semua kamera di timeline (satu kamera per track video), lalu export:
   - Final Cut Pro: **File › Export XML**.
   - DaVinci Resolve: **File › Export › Timeline** → pilih **FCPXML**.
4. Drop file `.fcpxml` ke halaman kontrol. Pilih **Open in** (Final Cut Pro / DaVinci Resolve) dan **Cut every** (2/4/6/8 beat).
5. Klik **Create edit**. Engine menyinkronkan setiap klip lewat audionya dan memotong mengikuti musik.
6. Import hasilnya:
   - Final Cut Pro: terbuka otomatis, berupa multicam clip (angle masih bisa diganti).
   - DaVinci Resolve: **File › Import › Timeline**, pilih file hasil. Potongan kamera di V1, musik di A1.
7. File hasil disimpan di **Movies › R Project Multicam**. Media aslimu tidak diubah.

**Catatan**
- Setiap kamera harus merekam suara musiknya (mic kamera cukup). Klip yang tidak bisa ditempatkan dengan yakin tidak dipakai dan
  tercatat di log.
- Drone / FPV tanpa audio belum didukung di versi ini.

**Kalau ada masalah**
- **"macOS cannot verify the developer"**: klik kanan file → **Open** → **Open**.
- **"FFmpeg not found"**: jalankan Install-FinalCut.command lagi saat online.
- **"Signed in on another device"**: satu akun hanya untuk satu komputer pada satu waktu. Masuk lagi di Mac ini.
- **"Trial expired"**: beli Lifetime di https://r-multicam.pages.dev/#pricing.
- **"not on this computer"**: footage di XML tidak ada di Mac ini. Export dari Mac yang menyimpan footage-nya.
- **Final Cut tidak terbuka otomatis**: klik **Show file**, lalu klik dua kali file `.fcpxml`, atau di Final Cut pilih
  File › Import › XML.

**Hapus**: klik kanan **Uninstall-FinalCut.command** → Open. Hasil edit di Movies › R Project Multicam tetap ada.

## English

**New in v1.2: from set to Reels.** Choose the music and one folder per camera, click **Find drops**, pick drops, then
**Export**: ready-to-post MP4s (9:16, 4:5 or 16:9; 15/30/60 s; zoom on the drop; .cube LUT). Also **Full set**,
**Final Cut XML** and **DaVinci XML** from the same result. Opens in its own window (R icon), no Terminal; closing the
window quits it. Exports use the GPU (NVIDIA, Intel, AMD, Apple) and the CPU side by side when available, and fall back
to the CPU if the GPU fails.

**Requirements**
- A Mac with macOS 12 or newer (Apple silicon or Intel).
- Final Cut Pro 10.6 or newer, or DaVinci Resolve 18 or newer.
- An R Project account (the same account as the Premiere plugin) and an internet connection to sign in.
- You don't need to install Node.js or FFmpeg yourself: the installer sets them up (official builds, SHA-256 verified).

**Install**
1. Extract the ZIP and move the folder to your home folder (don't run it from Downloads).
2. Right-click **Install-FinalCut.command** → **Open** → **Open**. No administrator password is needed.
3. When it finishes, **R Project Engine for Final Cut** starts. Later, open it from **Applications** or the Desktop.

**Installers**: Windows `R-Project-Multicam-AI-Setup-<version>.exe` (double-click, Next, Finish). Mac
`R-Project-Multicam-AI-<version>-Mac-AppleSilicon.zip` or `-Mac-Intel.zip` (open the ZIP, drag the app to Applications;
Node.js and FFmpeg are inside).

**Install on Windows from the ZIP (DaVinci Resolve)**: extract the ZIP and double-click **Install-Windows.bat**. Open **R Project Multicam AI**
from the Desktop or the Start menu. Edits are saved in **Videos › R Project Multicam**. Remove it with **Uninstall-Windows.bat**.

**Use**
1. Open **R Project Engine for Final Cut**. A Terminal window and the control page in your browser open. Keep Terminal open.
2. **Sign in** with your R Project account (email/password or Google). Premiere and Final Cut on one Mac count as one device.
3. In Final Cut / DaVinci, put the master music and every camera on the timeline (one camera per video track), then export:
   - Final Cut Pro: **File › Export XML**.
   - DaVinci Resolve: **File › Export › Timeline** → choose **FCPXML**.
4. Drop the `.fcpxml` on the control page. Choose **Open in** (Final Cut Pro / DaVinci Resolve) and **Cut every** (2/4/6/8 beats).
5. Click **Create edit**. The engine syncs every clip by its own audio and cuts to the music.
6. Import the result:
   - Final Cut Pro: it opens by itself as a multicam clip (you can still switch angles).
   - DaVinci Resolve: **File › Import › Timeline** and pick the result. Camera cuts are on V1, the music on A1.
7. Files are saved in **Movies › R Project Multicam**. Your media is not changed.

**Notes**
- Every camera has to hear the music (the on-camera mic is fine). Clips that cannot be placed reliably are left out and
  listed in the log.
- Drone / FPV clips without audio are not supported in this version yet.

**Troubleshooting**
- **"macOS cannot verify the developer"**: right-click the file → **Open** → **Open**.
- **"FFmpeg not found"**: run Install-FinalCut.command again while online.
- **"Signed in on another device"**: one account works on one computer at a time. Sign in again on this Mac.
- **"Trial expired"**: buy Lifetime at https://r-multicam.pages.dev/#pricing.
- **"not on this computer"**: the footage in the XML is not on this Mac. Export on the Mac that holds the footage.
- **Final Cut does not open by itself**: click **Show file** and double-click the `.fcpxml`, or in Final Cut choose
  File › Import › XML.

**Uninstall**: right-click **Uninstall-FinalCut.command** → Open. Your edits in Movies › R Project Multicam are kept.
