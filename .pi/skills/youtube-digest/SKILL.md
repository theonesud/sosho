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

## Protocol & Rules
1. **User Target Destination**: If the user requests output in a specific file or folder (e.g. `./notes.md`, "in this folder"), ALWAYS write to or copy the final result to that exact path.
2. **Strict Pacing & Tab Limits**: For playlist and feed discovery via Dokobot, never spawn unbounded background tabs. Maximum **2 concurrent reads**; pause with `sleep 1`.
3. **Sequential Execution**: Transcribe video by video in the requested order. Do not skip or drop videos.
4. **Honest Accounting**: Report exact video counts processed vs remaining in `.pi/work/state.json`. Never claim all videos in a playlist are summarized when only some were completed.
5. **Context Safety**: Read the concise outline from stdout (<25 lines). Inspect deeper slices with `bin/chunk-read.sh`.
