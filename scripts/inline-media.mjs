#!/usr/bin/env node
// The store listing's inline media, cut from rendered shots (scripts/store-inline.sh runs this on the build server, in
// the shadowlocks-e2e image, after scripts/video.sh rendered tests/video/shots/inline-*.ts). For each piece: a still,
// 24-bit PNG at the render size (2560x1440 for the store); for the loops also an MP4 (H.264, no sound, 3 to 6 s) and a
// GIF under 5 MB (smaller and slower settings until it fits). Writes inline.json with every file's facts and fails when
// one is missing or out of spec.
// Usage: node scripts/inline-media.mjs [<video dir, e.g. test-results/video/2560x1440-30>] [<out dir>]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SRC = process.argv[2] ?? "test-results/video/2560x1440-30";
const OUT = process.argv[3] ?? "test-results/store-inline";
const STORE_SIZE = "2560x1440";
const GIF_MAX_BYTES = 5 * 1024 * 1024;
const LOOP_SECONDS = [3, 6];
/** Settings tried in order until the GIF fits under 5 MB. */
const GIF_TRIES = [
  { width: 960, fps: 15, colors: 192 },
  { width: 800, fps: 12, colors: 160 },
  { width: 640, fps: 12, colors: 128 },
  { width: 560, fps: 10, colors: 96 },
];
export const PIECES = [
  { n: 1, name: "room", shot: "inline-room", still: 2, loop: false },
  { n: 2, name: "lock", shot: "inline-lock", still: 3, loop: true },
  { n: 3, name: "finger", shot: "inline-finger", still: 3, loop: true },
];

const ff = (args) => execFileSync("ffmpeg", ["-y", "-v", "error", ...args], { stdio: ["ignore", "pipe", "pipe"] });
function facts(file) {
  const j = JSON.parse(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,pix_fmt:format=duration", "-of", "json", file], {
      encoding: "utf8",
    }),
  );
  const v = (j.streams ?? []).find((s) => s.codec_type === "video") ?? {};
  return {
    codec: v.codec_name,
    width: v.width,
    height: v.height,
    pixFmt: v.pix_fmt,
    audio: (j.streams ?? []).some((s) => s.codec_type === "audio"),
    seconds: Number(j.format?.duration ?? 0),
    bytes: fs.statSync(file).size,
  };
}

const size = path.basename(SRC).split("-")[0];
const [W, H] = size.split("x").map(Number);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const problems = [];
const report = { made: new Date().toISOString(), from: SRC, size, files: [] };
if (size !== STORE_SIZE) console.log(`inline-media: note: ${size} is a draft size; the store's stills are ${STORE_SIZE}`);

for (const p of PIECES) {
  const base = `inline-${p.n}-${p.name}`;
  const still = path.join(SRC, `${p.shot}-still-${p.still}.png`);
  if (!fs.existsSync(still)) {
    problems.push(`${p.shot}: no still ${still} (render the shot first)`);
    continue;
  }
  const stillOut = path.join(OUT, `${base}-${size}.png`);
  ff(["-i", still, "-frames:v", "1", "-pix_fmt", "rgb24", stillOut]);
  const s = facts(stillOut);
  if (s.width !== W || s.height !== H || s.pixFmt !== "rgb24") problems.push(`${stillOut}: ${s.width}x${s.height} ${s.pixFmt}`);
  report.files.push({ file: path.basename(stillOut), ...s });
  if (!p.loop) continue;

  const mp4 = path.join(SRC, `${p.shot}.mp4`);
  if (!fs.existsSync(mp4)) {
    problems.push(`${p.shot}: no ${mp4}`);
    continue;
  }
  const mp4Out = path.join(OUT, `${base}.mp4`);
  ff(["-i", mp4, "-an", "-c:v", "copy", "-movflags", "+faststart", mp4Out]);
  const m = facts(mp4Out);
  if (m.codec !== "h264" || m.audio) problems.push(`${mp4Out}: ${m.codec}, audio ${m.audio}`);
  if (m.seconds < LOOP_SECONDS[0] - 0.05 || m.seconds > LOOP_SECONDS[1] + 0.05) problems.push(`${mp4Out}: ${m.seconds.toFixed(2)} s, want 3 to 6`);
  report.files.push({ file: path.basename(mp4Out), ...m });

  const gifOut = path.join(OUT, `${base}.gif`);
  let fit = null;
  for (const t of GIF_TRIES) {
    const filter = `fps=${t.fps},scale=${t.width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${t.colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;
    ff(["-i", mp4, "-filter_complex", filter, "-loop", "0", gifOut]);
    if (fs.statSync(gifOut).size <= GIF_MAX_BYTES) {
      fit = t;
      break;
    }
  }
  const g = facts(gifOut);
  if (!fit) problems.push(`${gifOut}: ${g.bytes} bytes even at the smallest settings`);
  report.files.push({ file: path.basename(gifOut), ...g, gif: fit });
}

fs.writeFileSync(path.join(OUT, "inline.json"), `${JSON.stringify({ ...report, problems }, null, 2)}\n`);
for (const f of report.files) console.log(`inline-media: ${f.file}: ${f.width}x${f.height} ${f.codec} ${(f.bytes / 1024).toFixed(0)} KB${f.seconds ? ` ${f.seconds.toFixed(2)} s` : ""}`);
if (problems.length) {
  for (const p of problems) console.error(`inline-media: ${p}`);
  process.exit(1);
}
console.log(`inline-media: ${report.files.length} files in ${OUT}`);
