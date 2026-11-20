# R Project Multicam AI for Final Cut Pro (macOS) · v1.0.0

## Bahasa Indonesia

**Yang dibutuhkan**
- macOS 11 atau lebih baru (Apple Silicon atau Intel).
- Final Cut Pro 10.6 atau lebih baru.
- Akun R Project (akun yang sama dengan plugin Premiere) dan koneksi internet untuk masuk.
- Node.js dan FFmpeg tidak perlu dipasang sendiri; installer menyiapkannya bila belum ada.

**Pasang**
1. Ekstrak seluruh isi ZIP ke sebuah folder (sebaiknya di folder Home, bukan Downloads/Desktop/Documents).
2. **Klik kanan** (atau Control-klik) **Install-FinalCut.command** > **Open** > **Open**. Pertama kali macOS mungkin
   memblokirnya: buka **System Settings > Privacy & Security**, gulir ke bawah, klik **Open Anyway**, lalu jalankan lagi.
3. Setelah selesai, **R Project Engine for Final Cut** ada di folder Applications Anda (cari lewat Launchpad atau
   Spotlight). Browser membuka halaman kontrol.

**Pakai**
1. Buka **R Project Engine for Final Cut**. **Masuk** dengan akun R Project (email/password atau Google).
2. **Music**: klik *Choose music…* dan pilih audio master set (WAV/AIFF/MP3, atau video yang ada audionya).
   Malam yang direkam beberapa bagian: pilih semua file musiknya sekaligus.
3. **Cameras**: klik *Add camera…* dan pilih **semua klip dari SATU kamera** (Command-klik untuk memilih beberapa).
   Ulangi untuk setiap kamera. Isi peran kamera (Master Wide, DJ Close-Up, Crowd, Drone…).
   Kamera tidak perlu disinkron dulu: setiap klip disinkron otomatis dari suaranya sendiri, jadi kamera harus merekam suara.
4. Klik **Create Multicam Edit**. Engine menganalisis BPM, beat dan drop, menyinkronkan semua klip, memilih kamera per
   potongan, lalu membuat file **.fcpxml** di `Movies/R Project Multicam`.
5. Final Cut Pro terbuka dan menanyakan library tujuan. Hasilnya: event **R Project Multicam AI** berisi satu
   **multicam clip** (satu angle per kamera + angle musik) dan sebuah **project** yang sudah dipotong mengikuti beat,
   dengan marker di setiap drop. Potongannya tetap multicam edit biasa, jadi angle masih bisa diganti di Final Cut.

**Kalau ada masalah**
- **"Final Cut Pro was not found"**: di Final Cut pilih *File > Import > XML…* lalu pilih file .fcpxml-nya
  (tombol *Show in Finder* di halaman engine menunjukkan lokasinya).
- **Klip kamera "left out"**: suara klip itu tidak cocok dengan musik (kamera tanpa audio, terlalu pendek, atau bukan
  dari set ini). Klip lain tetap dipakai.
- **Media offline di Final Cut**: jangan pindahkan file musik/kamera setelah membuat edit; kalau terlanjur, gunakan
  *File > Relink Files* di Final Cut.
- **"Signed in on another device"**: satu akun hanya untuk satu komputer pada satu waktu. Masuk lagi di Mac ini.
- **"Trial expired"**: beli Lifetime di https://r-multicam.pages.dev/#pricing.
- **Halaman engine tidak terbuka**: buka lagi *R Project Engine for Final Cut*. Log ada di
  `~/Library/Application Support/RProjectMulticam/finalcut/engine.log`.

**Hapus**: klik kanan **Uninstall-FinalCut.command** > **Open**. File .fcpxml Anda dan library Final Cut tidak dihapus.

## English

**Requirements**
- macOS 11 or newer (Apple silicon or Intel).
- Final Cut Pro 10.6 or newer.
- An R Project account (the same account as the Premiere plugin) and an internet connection to sign in.
- You don't need to install Node.js or FFmpeg yourself: the installer sets them up when they are missing (official
  builds, pinned versions, SHA-256 verified). An FFmpeg already set up by the R Project Premiere plugin is reused.

**Install**
1. Extract the whole ZIP (preferably into your home folder, not Downloads, Desktop or Documents).
2. **Right-click** (or Control-click) **Install-FinalCut.command** > **Open** > **Open**. The first time, macOS may block
   it: open **System Settings > Privacy & Security**, scroll down, click **Open Anyway**, then run it again.
3. When it finishes, **R Project Engine for Final Cut** is in your Applications folder (Launchpad or Spotlight). Your
   browser shows the control page.

**Use**
1. Open **R Project Engine for Final Cut** and **sign in** with your R Project account (email/password or Google).
2. **Music**: click *Choose music…* and pick the master audio of the set (WAV/AIFF/MP3, or a video with sound).
   A night recorded in several parts: select all of its music files at once.
3. **Cameras**: click *Add camera…* and select **every clip of ONE camera** (Command-click to select several). Repeat for
   each camera and type its role (Master Wide, DJ Close-Up, Crowd, Drone…). The cameras do not need to be synced first:
   every clip is synced from its own sound, so the cameras must record audio.
4. Click **Create Multicam Edit**. The engine reads BPM, beats and drops, syncs every clip, picks a camera for each shot
   and writes an **.fcpxml** to `Movies/R Project Multicam`.
5. Final Cut Pro opens and asks which library to import into. You get an event **R Project Multicam AI** with one
   **multicam clip** (an angle per camera plus a music angle) and a **project** cut on the beat, with a marker on every
   drop. The cuts are normal multicam edits, so you can still switch angles in Final Cut.

**Troubleshooting**
- **"Final Cut Pro was not found"**: in Final Cut choose *File > Import > XML…* and pick the .fcpxml (*Show in Finder*
  on the engine page shows where it is).
- **A camera clip was "left out"**: its sound did not match the music (no audio, too short, or not from this set). The
  other clips are still used.
- **Offline media in Final Cut**: don't move the music or camera files after creating the edit; if you did, use
  *File > Relink Files* in Final Cut.
- **"Signed in on another device"**: one account works on one computer at a time. Sign in again on this Mac.
- **"Trial expired"**: buy Lifetime at https://r-multicam.pages.dev/#pricing.
- **The engine page does not open**: open *R Project Engine for Final Cut* again. The log is in
  `~/Library/Application Support/RProjectMulticam/finalcut/engine.log`.

**Uninstall**: right-click **Uninstall-FinalCut.command** > **Open**. Your .fcpxml files and Final Cut libraries are kept.

**Privacy**: music and video are analyzed on your Mac and never uploaded. Only sign-in and the license check use the
internet.
