# Photographic rooms for film shots

Equirectangular photographs drawn behind the game in video renders only (a shot's `photoRoom`, `lib/page-video.ts`
`photoRoom`), standing in for the player's room. Edits that use them label those shots "Simulated room". Never part of
a build: nothing under `tests/` reaches `dist/`.

## lythwood_lounge-film.jpg

- Source: "Lythwood Lounge" by Greg Zaal, Poly Haven, https://polyhaven.com/a/lythwood_lounge
- File used: the 8192x4096 tone-mapped JPG,
  https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/lythwood_lounge.jpg (5.0 MB, fetched 2026-11-12)
- Licence: CC0 1.0 Universal (public domain dedication), https://polyhaven.com/license and
  https://creativecommons.org/publicdomain/zero/1.0/ . No attribution is required; it is given anyway.
- Changes (ffmpeg, from the downloaded JPG):
  1. Readable text softened with a feathered blur (box blur 22, 3 passes, 36 px soft edge): the "LYTHWOOD" plaque on
     the fireplace, the books on the three coffee tables (one titled "Britain") and the crest on a white cushion.
     Regions (x:y:w:h in the 8192x4096 image): 40:2080:110:60, 330:2290:200:85, 1680:2285:145:55,
     4970:2265:220:110, 6580:2385:190:90, 630:2195:125:80.
  2. Graded for the film: the tone map's yellow and orange pulled back to warm white walls and cream sofas (yellows,
     whites and neutrals lose yellow; the parquet stays warm brown), a little contrast added:
     `selectivecolor=correction_method=relative:yellows=0 0 -0.6 0:whites=0 0 -0.35 0:neutrals=0 0 -0.10 0,colorbalance=rs=-0.02:rm=-0.03:gm=0.01:bm=0.02:rh=-0.02:bh=0.02,eq=saturation=0.8:contrast=1.08:gamma=0.96`
     (applied to RGB24 after the blur; replaces the first grade, a colour balance alone, which left the room yellow).
  3. Saved as JPEG, 4:4:4, `-q:v 2` (4.9 MB, so it is kept in git).

To make it again, run the blur regions and the grade above in one `-filter_complex` on the downloaded file (each
region: crop it padded by 36 px, blur it, merge it back through a mask that is white inside and blurred at its edge).

The panorama's camera height is not published; it looks like a standing eye (about 1.5 m), a little above a seated
player's 1.2 m. Its horizon is level. In the shots, yaw -135 puts the sofas round the coffee table and the fireplace
wall straight ahead (`yawDeg` turns it: the photograph's column 0.5 + yaw / 360 is straight ahead, as ffmpeg's v360).
