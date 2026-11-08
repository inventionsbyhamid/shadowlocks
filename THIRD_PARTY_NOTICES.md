# Third-party notices

Shadow Locks ships the following works by others. Each is used under its own licence, whose full text travels
with the files.

## Fonts

All five are licensed under the SIL Open Font License, Version 1.1. They are taken from the google/fonts
repository at commit `6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec`, cut to one weight and to the characters the game
shows, and turned into text atlases by `scripts/fonts/build-fonts.sh`. Those are modified versions under the
licence. They never use a Reserved Font Name: Limelight and Josefin Sans reserve theirs, so our copies of them are
renamed Shadow Locks Display and Shadow Locks Sans.

| Font | Copyright | Files | Licence text |
|---|---|---|---|
| Inter (Medium, Bold) | Copyright 2020 The Inter Project Authors (https://github.com/rsms/inter) | `public/fonts/inter-md.*`, `public/fonts/inter-bd.*` | `public/fonts/OFL-inter.txt` |
| Josefin Sans (Bold), renamed Shadow Locks Sans | Copyright 2010 The Josefin Sans Project Authors (https://github.com/ThomasJockin/JosefinSansFont-master), with Reserved Font Name "Josefin Sans" | `public/fonts/josefin-bd.*` | `public/fonts/OFL-josefinsans.txt` |
| Limelight (Regular), renamed Shadow Locks Display | Copyright (c) 2011 by Sorkin Type Co (www.sorkintype.com), with Reserved Font Name "Limelight" | `public/fonts/limelight.*` | `public/fonts/OFL-limelight.txt` |
| Noto Sans JP (Bold) | Copyright 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source' | `public/fonts/noto-jp.*` | `public/fonts/OFL-notosansjp.txt` |
| Noto Serif (Bold, Italic) | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/latin-greek-cyrillic) | `public/fonts/noto-serif-bd.woff2`, `public/fonts/noto-serif-it.woff2` | `public/fonts/OFL-notoserif.txt` |

## Controller models

The WebXR input profiles in `public/input-profiles/` (the generic hand; Quest 3's, Quest Pro's and Quest 2's
controllers) are MIT licensed, Copyright (c) 2019 Amazon. The licence text is in `public/input-profiles/LICENSE.md`.

## IWER hand poses

`src/lessons/poses.json` (the lessons' ghost hand: the open, pinch, point and relaxed poses) holds joint positions
exported by `scripts/export-poses.mjs` from the hand pose library of IWER, the Immersive Web Emulation Runtime
(`iwer` 2.7.0, https://github.com/meta-quest/immersive-web-emulation-runtime), under the MIT License:

```
MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
