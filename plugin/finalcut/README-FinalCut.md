# R Project Multicam AI for Final Cut Pro (macOS) · v1.0.0

## Bahasa Indonesia

**Yang dibutuhkan**
- Mac dengan macOS 12 atau lebih baru (Apple Silicon atau Intel).
- Final Cut Pro 10.6 atau lebih baru.
- Akun R Project (akun yang sama dengan plugin Premiere) dan koneksi internet untuk masuk.
- Node.js dan FFmpeg tidak perlu dipasang sendiri; installer menyiapkannya (versi resmi, dicek SHA-256).

**Pasang**
1. Ekstrak ZIP, lalu pindahkan foldernya ke folder home kamu (jangan dijalankan dari Downloads).
2. Klik kanan **Install-FinalCut.command** → **Open** → **Open**. Tidak perlu password administrator.
3. Setelah selesai, **R Project Engine for Final Cut** terbuka sendiri. Nanti bisa dibuka lagi dari folder
   **Applications** atau Desktop.

**Pakai**
1. Buka **R Project Engine for Final Cut**. Jendela Terminal dan halaman kontrol di browser terbuka. Biarkan Terminal tetap terbuka.
2. **Masuk** dengan akun R Project (email/password atau Google). Status menampilkan sisa trial atau *Lifetime*.
   Premiere dan Final Cut di Mac yang sama dihitung sebagai satu perangkat.
3. **1 · Music**: klik **Choose music…** lalu pilih rekaman musik master / DJ set. Klik **Analyze Music** untuk melihat BPM dan drop.
4. **2 · Cameras**: klik **Add camera folder…** sekali untuk setiap kamera (satu folder = satu kamera, berisi semua klip kamera itu).
   Isi role kamera, misalnya *Master Wide*, *DJ Close-Up*, *Crowd*.
5. **3 · Auto Cut Multicam**: pilih Cut every (2/4/6/8 beat) dan Main Drop Camera, lalu klik **Create Multicam Edit**.
6. Engine menyinkronkan setiap klip lewat audionya, memotong mengikuti musik, lalu membuka file `.fcpxml` di Final Cut Pro.
   Pilih library, lalu buka project **"<nama musik> - Multicam AI"**. Multicam clip-nya ada di event **R Project Multicam AI**,
   jadi angle masih bisa diganti di Final Cut.
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
- **Final Cut tidak terbuka otomatis**: klik **Show in Finder**, lalu klik dua kali file `.fcpxml`, atau di Final Cut pilih
  File › Import › XML.

**Hapus**: klik kanan **Uninstall-FinalCut.command** → Open. Hasil edit di Movies › R Project Multicam tetap ada.

## English

**Requirements**
- A Mac with macOS 12 or newer (Apple silicon or Intel).
- Final Cut Pro 10.6 or newer.
- An R Project account (the same account as the Premiere plugin) and an internet connection to sign in.
- You don't need to install Node.js or FFmpeg yourself: the installer sets them up (official builds, SHA-256 verified).

**Install**
1. Extract the ZIP and move the folder to your home folder (don't run it from Downloads).
2. Right-click **Install-FinalCut.command** → **Open** → **Open**. No administrator password is needed.
3. When it finishes, **R Project Engine for Final Cut** starts. Later, open it from **Applications** or the Desktop.

**Use**
1. Open **R Project Engine for Final Cut**. A Terminal window and the control page in your browser open. Keep Terminal open.
2. **Sign in** with your R Project account (email/password or Google). Premiere and Final Cut on one Mac count as one device.
3. **1 · Music**: click **Choose music…** and pick the master music / DJ-set recording. **Analyze Music** shows BPM and drops.
4. **2 · Cameras**: click **Add camera folder…** once per camera (one folder = one camera, with all of that camera's clips).
   Type a role per camera, e.g. *Master Wide*, *DJ Close-Up*, *Crowd*.
5. **3 · Auto Cut Multicam**: choose Cut every (2/4/6/8 beats) and the Main Drop Camera, then click **Create Multicam Edit**.
6. The engine syncs every clip by its own audio, cuts to the music and opens the `.fcpxml` in Final Cut Pro. Choose a library,
   then open the project **"<music name> - Multicam AI"**. The multicam clip is in the **R Project Multicam AI** event, so you
   can still switch angles in Final Cut.
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
- **Final Cut does not open by itself**: click **Show in Finder** and double-click the `.fcpxml`, or in Final Cut choose
  File › Import › XML.

**Uninstall**: right-click **Uninstall-FinalCut.command** → Open. Your edits in Movies › R Project Multicam are kept.
