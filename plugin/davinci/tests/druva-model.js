// The Druva 120 s test timeline as DaVinci would hold it (frames, 25 fps, timeline start 86400), shared by the
// Node mock DaVinci (protocol-test) and the Lua mock (lua-bridge-e2e).
// Timeline 0 s = master 11346 s. V1-V4 = cameras, V5 = compound clip (no file), V6 = locked, V1 also has a transition.
'use strict';
const T0 = 11346, FPS = 25, TL0 = 86400, N = 120 * FPS;
const WAV = 'H:/Druva Atlas/Wild ones atlas.wav';
const CAMS = [['H:/Druva Atlas/cam 4/DAV3618.MP4', -238.605], ['H:/Druva Atlas/cam 2]/Cam A_1990.MP4', 10477.2],
  ['H:/Druva Atlas/Cam 1/C0018.MP4', 10111.101], ['H:/Druva Atlas/cam 3/DJI_20261004005334_0003_D.MP4', 8498.523]];

function druvaModel() {
  // Live: a WAV reports the PROJECT rate (24) as its FPS and its source frames are in 24 fps units.
  const media = [{ id: 'mpi-wav', path: WAV, fps: '24', type: 'Audio' }]
    .concat(CAMS.map(([p], i) => ({ id: 'mpi-cam' + (i + 1), path: p, fps: '25', type: 'Video + Audio' })))
    .concat([{ id: 'mpi-compound', path: '', fps: '25', type: 'Compound Clip' }]);
  const clip = (id, mpiId, src, extra) => Object.assign({ id, name: id, type: 'video', start: TL0, end: TL0 + N, srcStart: src, srcEnd: src + N, enabled: true, mpiId }, extra || {});
  const video = CAMS.map(([, anchor], i) => ({ enabled: true, locked: false, items: [clip('v' + (i + 1), 'mpi-cam' + (i + 1), Math.round((T0 - anchor) * FPS))] }));
  video[0].items.push({ id: 'tr1', name: 'Cross Dissolve', type: 'transition', start: TL0 + 1000, end: TL0 + 1010, enabled: true });
  video.push({ enabled: true, locked: false, items: [clip('v5', 'mpi-compound', 0)] });
  video.push({ enabled: true, locked: true, items: [clip('v6', 'mpi-cam1', 0)] });
  // 3000 record frames = 2880 source frames (24 fps); GetSourceEndFrame looked inclusive at the media end (live: 2879).
  const audio = [{ items: [clip('a1', 'mpi-wav', T0 * 24, { type: 'audio', srcEnd: T0 * 24 + 2879 })] }];
  return {
    projectName: 'Druva Atlas', projectFps: '24',
    media,
    timelines: [{ id: 'tl-orig', name: 'Druva test', start: TL0, fps: '25', width: '1920', height: '1080', custom: '1', video, audio,
      marks: { video: { in: 10, out: 200 } } }],
    current: 'tl-orig',
    renderFormat: { format: 'mov', codec: 'ProRes422' },
  };
}

module.exports = { druvaModel, T0, FPS, TL0, N, WAV, CAMS };
