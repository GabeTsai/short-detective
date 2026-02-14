import sys
import subprocess
import os

import sys
import subprocess
import os


def extract_audio(video_path, output_path=None):
    """Extract audio from a video file and save as mp3."""
    if not os.path.exists(video_path):
        print(f"Error: {video_path} not found")
        sys.exit(1)

    if output_path is None:
        video_dir = os.path.dirname(video_path)
        parent_dir = os.path.dirname(video_dir)
        audio_dir = os.path.join(parent_dir, "audio")
        os.makedirs(audio_dir, exist_ok=True)
        base = os.path.splitext(os.path.basename(video_path))[0]
        output_path = os.path.join(audio_dir, base + ".mp3")

    if os.path.exists(output_path):
        print(f"Already exists: {output_path}")
        return output_path

    result = subprocess.run(
        ["ffmpeg", "-i", video_path, "-vn", "-acodec", "libmp3lame", "-q:a", "2", output_path],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(result.stderr)
        sys.exit(1)
    print(f"Saved to {output_path}")
    return output_path

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python extract_audio.py <video_path> [output_path]")
        sys.exit(1)

    video = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else None
    extract_audio(video, out)