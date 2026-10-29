---
name: youtube-digest
description: Discover videos from logged-in YouTube (liked videos, playlists, searches) and instantly pull full timestamped transcripts for analysis and summarization.
---

# YouTube Digest: Feed Discovery & Sub-Second Transcription

Combines host Chrome via Dokobot (for authenticated feeds/playlists) with `youtube-transcript-api` (for instant subtitles without video downloading).

## Usage

```bash
# 1. Discover videos from Liked Videos playlist
.pi/skills/youtube-digest/scripts/yt-feed.sh likes

# 2. Discover videos from a specific playlist or search
.pi/skills/youtube-digest/scripts/yt-feed.sh "https://www.youtube.com/playlist?list=PL..."
.pi/skills/youtube-digest/scripts/yt-feed.sh "quantum computing 2026"

# 3. Transcribe a video immediately (saves to .pi/work/transcripts/<id>.md)
.pi/skills/youtube-digest/scripts/yt-transcribe.py "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
.pi/skills/youtube-digest/scripts/yt-transcribe.py "dQw4w9WgXcQ"
```

## Protocol
1. Run `yt-transcribe.py` for direct video URLs.
2. Read the outline from stdout (<25 lines).
3. Synthesize the core concepts, quotes, and takeaways.
4. For deeper citation, inspect bounded slices via `bin/chunk-read.sh .pi/work/transcripts/<id>.md <start> <lines>`.
