---
name: youtube-digest
description: Discover videos from logged-in YouTube (liked videos, playlists, searches) and pull timestamped transcripts for analysis and summarization.
---

# YouTube Digest: Feed Discovery & Sub-Second Transcription

Combines host Chrome via Dokobot (for authenticated feeds/playlists) with `youtube-transcript-api` (for instant subtitles without video downloading).

## Usage

```bash
# 1. Discover videos from Liked Videos playlist
.agents/skills/youtube-digest/scripts/yt-feed.sh likes

# 2. Discover videos from playlist or search
.agents/skills/youtube-digest/scripts/yt-feed.sh "https://www.youtube.com/playlist?list=PL..."
.agents/skills/youtube-digest/scripts/yt-feed.sh "quantum computing 2026"

# 3. Transcribe a video immediately (saves to $SOSHO_PERMANENT_DIR/<video_id>.md)
.agents/skills/youtube-digest/scripts/yt-transcribe.py "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
.agents/skills/youtube-digest/scripts/yt-transcribe.py "dQw4w9WgXcQ"
```

## Protocol
1. Discovery saves queue to `$SOSHO_PERMANENT_DIR/queue.md`.
2. Transcribe outputs concise outline to stdout (<25 lines); inspect details via `bin/chunk-read.sh`.
3. Follow SYSTEM.md pacing and `task_*` accounting for batch transcriptions.
