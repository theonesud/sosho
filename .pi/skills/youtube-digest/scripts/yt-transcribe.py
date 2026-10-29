#!/usr/bin/env python3
"""
yt-transcribe.py: Fast YouTube transcript extractor using youtube-transcript-api.
Writes full timestamped transcript to .pi/work/transcripts/<video_id>.md.
Outputs a compact ~25-line outline to stdout for context safety.
"""
import sys
import re
import os
from urllib.parse import urlparse, parse_qs

def extract_video_id(url_or_id):
    if len(url_or_id) == 11 and re.match(r'^[a-zA-Z0-9_-]+$', url_or_id):
        return url_or_id
    
    parsed = urlparse(url_or_id)
    if parsed.hostname in ('youtu.be', 'www.youtu.be'):
        return parsed.path.lstrip('/')
    if parsed.hostname in ('youtube.com', 'www.youtube.com', 'm.youtube.com'):
        if parsed.path == '/watch':
            return parse_qs(parsed.query).get('v', [None])[0]
        if parsed.path.startswith(('/embed/', '/v/', '/shorts/')):
            return parsed.path.split('/')[2]
    return None

def format_timestamp(seconds):
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{mins:02d}:{secs:02d}"

def main():
    if len(sys.argv) < 2:
        print("Usage: yt-transcribe.py <youtube-url-or-id> [out-dir]", file=sys.stderr)
        sys.exit(1)

    target = sys.argv[1]
    out_dir = sys.argv[2] if len(sys.argv) > 2 else os.getenv("SOSHO_TRANSCRIPTS_DIR", ".pi/work/transcripts")
    os.makedirs(out_dir, exist_ok=True)

    video_id = extract_video_id(target)
    if not video_id:
        print(f"❌ Error: Could not extract valid YouTube video ID from '{target}'", file=sys.stderr)
        sys.exit(1)

    out_file = os.path.join(out_dir, f"{video_id}.md")

    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        transcript_list = YouTubeTranscriptApi.get_transcript(video_id)
    except Exception as e:
        print(f"❌ Failed to fetch transcript for {video_id}: {e}", file=sys.stderr)
        sys.exit(1)

    # Paragraph grouping (every ~45-60 seconds or 8-10 chunks)
    paragraphs = []
    current_para = []
    current_start = 0.0

    for i, item in enumerate(transcript_list):
        text = item.get('text', '').strip()
        start = item.get('start', 0.0)
        if not current_para:
            current_start = start
        current_para.append(text)

        if start - current_start >= 45.0 or len(current_para) >= 8:
            para_text = " ".join(current_para)
            ts = format_timestamp(current_start)
            paragraphs.append(f"**[{ts}]** {para_text}")
            current_para = []

    if current_para:
        para_text = " ".join(current_para)
        ts = format_timestamp(current_start)
        paragraphs.append(f"**[{ts}]** {para_text}")

    full_markdown = f"# YouTube Transcript: {video_id}\n\nURL: https://www.youtube.com/watch?v={video_id}\n\n"
    full_markdown += "\n\n".join(paragraphs) + "\n"

    with open(out_file, "w", encoding="utf-8") as f:
        f.write(full_markdown)

    total_words = sum(len(p.split()) for p in paragraphs)
    total_minutes = format_timestamp(transcript_list[-1]['start'] if transcript_list else 0)

    print("=== [YOUTUBE TRANSCRIPT EXTRACTED] ===")
    print(f"• Video ID: {video_id} (Length: ~{total_minutes}, ~{total_words} words)")
    print(f"• Saved to: {out_file}")
    print("------------------------------------------------------------")
    print("• Sample Excerpt (first 3 chapters):")
    for p in paragraphs[:3]:
        print(p[:150] + ("..." if len(p) > 150 else ""))
        print()
    if len(paragraphs) > 3:
        print(f"[... {len(paragraphs) - 3} more sections in {out_file} ...]")
    print("============================================================")

if __name__ == '__main__':
    main()
