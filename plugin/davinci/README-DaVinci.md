# R Project Multicam AI for DaVinci Resolve (Windows) · v1.0.0

## Bahasa Indonesia

**Yang dibutuhkan**
- Windows 10 atau 11 (64-bit).
- DaVinci Resolve 18 atau lebih baru, versi **gratis atau Studio**.
- Akun R Project (akun yang sama dengan plugin Premiere) dan koneksi internet untuk masuk.
- Node.js dan FFmpeg tidak perlu dipasang sendiri; installer menyiapkannya bila belum ada.

**Pasang**
1. Ekstrak seluruh isi ZIP ke sebuah folder.
2. Klik dua kali **Install-DaVinci.bat** (jangan pakai *Run as administrator*). Windows akan meminta izin
   administrator satu kali, hanya untuk menaruh skrip di `C:\ProgramData\...`: klik **Yes**.
3. **Tutup lalu buka lagi DaVinci Resolve.**

**Pakai**
1. Buka **R Project Engine** (shortcut di Desktop atau Start menu). Browser membuka halaman kontrol. Biarkan jendela
   hitamnya tetap terbuka.
2. **Masuk** dengan email dan password akun R Project. Belum punya akun? Buat di https://r-multicam.pages.dev.
   Status menampilkan sisa trial atau *Lifetime*.
3. Di DaVinci, buka timeline: musik di **A1**, kamera yang sudah sinkron di **V1, V2, V3...**
4. Pilih **Workspace > Scripts > R Project Multicam AI**. Halaman Engine menampilkan **DaVinci connected**.
5. Tombol:
   - **Analyze Music**: membaca BPM, beat dan drop.
   - **Create Multicam Edit**: membuat timeline baru "<nama> - Multicam AI". Timeline asli tidak diubah.
   - **Render Best Drops**: merender klip MP4 ke `Videos\R Project Best Drops`.

**Kalau ada masalah**
- **Skrip tidak ada di menu Scripts:**
  - Tutup dan buka lagi DaVinci.
  - Pastikan file ada di `C:\ProgramData\Blackmagic Design\DaVinci Resolve\Fusion\Scripts\Utility`.
  - Kalau tidak ada, jalankan installer lagi dan klik Yes saat Windows meminta izin administrator.
- **"Waiting for DaVinci" terus:**
  - Jalankan lagi Workspace > Scripts > R Project Multicam AI.
  - Kalau DaVinci sedang menjalankan skrip lain, tunggu sampai selesai.
- **"Signed in on another device":** satu akun hanya untuk satu komputer pada satu waktu. Masuk lagi di komputer ini.
- **"Trial expired":** beli Lifetime di https://r-multicam.pages.dev/#pricing.
- **Lupa password:** isi email lalu klik *Forgot password*.
- **Login dengan Google:** klik *Continue with Google*, selesaikan di tab browser yang terbuka, lalu kembali ke halaman R Project Engine (halaman ini akan update sendiri). Jangan pernah mengetik password Google di halaman engine.

**Hapus**: tutup DaVinci Resolve, klik dua kali **Uninstall-DaVinci.bat** (Engine dihentikan otomatis), lalu buka lagi DaVinci.

## English

**Requirements**
- Windows 10 or 11 (64-bit).
- DaVinci Resolve 18 or newer, **Free or Studio**.
- An R Project account (the same account as the Premiere plugin) and an internet connection to sign in.
- You don't need to install Node.js or FFmpeg yourself: the installer sets them up when they are missing (official
  builds, pinned versions, SHA-256 verified).

**Install**
1. Extract the whole ZIP.
2. Double-click **Install-DaVinci.bat** (not *Run as administrator*). Windows asks for administrator permission once,
   only to put the script into `C:\ProgramData\...`: click **Yes**.
3. **Restart DaVinci Resolve.**

**Use**
1. Start **R Project Engine** from the Desktop or Start menu. A browser page opens. Keep the console window open.
2. Sign in with your R Project account. If you don't have one, create it at https://r-multicam.pages.dev. The status
   line shows the trial days left or *Lifetime*.
3. In DaVinci, open your timeline: music on **A1**, synced cameras on **V1, V2, V3…**
4. Choose **Workspace > Scripts > R Project Multicam AI**. The page shows **DaVinci connected**.
5. Buttons:
   - **Analyze Music** reads the BPM, beats and drops.
   - **Create Multicam Edit** builds a new timeline "<name> - Multicam AI"; the original timeline is not changed.
   - **Render Best Drops** renders MP4 clips to `Videos\R Project Best Drops`.

**Troubleshooting**
- **Script not in the Scripts menu:**
  - Restart DaVinci.
  - Check that the file is in `C:\ProgramData\Blackmagic Design\DaVinci Resolve\Fusion\Scripts\Utility`.
  - If it isn't, run the installer again and click Yes when Windows asks for administrator permission.
- **Page stays on "Waiting for DaVinci":**
  - Run Workspace > Scripts > R Project Multicam AI again.
  - If another DaVinci script is running, wait for it to finish.
- **"Signed in on another device":** one account works on one computer at a time. Sign in again on this one.
- **"Trial expired":** buy Lifetime at https://r-multicam.pages.dev/#pricing.
- **Forgot your password:** enter your email and click *Forgot password*.
- **Sign in with Google:** click *Continue with Google*, finish in the browser tab that opens, then return to the R Project Engine page (it updates by itself). Never type your Google password on the engine page.

**Uninstall**: close DaVinci Resolve, double-click **Uninstall-DaVinci.bat** (it stops R Project Engine itself), then start DaVinci again.

**Known limits**:
- No Random Zoom.
- No Keep-Clips mode; results always go into a new timeline.
- While the bridge script runs, other DaVinci scripts wait their turn.
