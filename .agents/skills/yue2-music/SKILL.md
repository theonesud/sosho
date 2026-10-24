---
name: yue2-music
description: Generate complete AI music, songs, vocal tracks, and instrumentals using the local YuE2-3B model via audio.cpp CUDA runtime. Use whenever the user asks to compose music, generate a song, create a soundtrack, or synthesize vocals from lyrics.
---

# YuE2 Music Generation Skill

Generate full-fidelity 48kHz stereo music and songs directly using the local quantized YuE2-3B model and `audio.cpp` CUDA backend.

## CLI Command

```bash
yue2-music --style "<style description>" --lyrics "<lyrics with tags>" [--out output.wav]
```

Or calling the generator script directly:
```bash
/home/vegeta/sosho/yue2-generate.sh --style "acoustic indie pop, female vocals, soft acoustic guitar" --lyrics "[Verse]\nWalking down the quiet street\n[Chorus]\nStars begin to shine" --out my_song.wav
```

## Options & Guidance

- **`--style` (required)**: Genre, instruments, vocal timbre, mood, BPM.
  - *Example*: `"90s grunge rock, distorted electric guitars, heavy energetic drums, male raspy vocals, 120 BPM"`
  - *Example*: `"ambient electronic synthwave, dreamy female vocal, retro analog synthesizers, 95 BPM"`
- **`--lyrics` (required)**: Section-tagged lyrics (e.g., `[Verse]`, `[Chorus]`, `[Bridge]`, `[Outro]`). For purely instrumental tracks, you can leave lyrics minimal or pass an instrumental cue.
- **`--out` (optional)**: Output WAV file path (defaults to `song.wav` in the current directory).
- **`--cot` (optional)**: Symbolic chain-of-thought planning (`melody` [default], `full`, or `off`).
- **`--stop-after` (optional)**:
  - `audio`: Full song generation (default).
  - `abc`: Quick symbolic score generation in ABC notation.
