"""Live TV's transcode command: one channel, HDHomeRun MPEG-2/AC-3 -> H.264/AAC MPEG-TS, run as an ffmpeg process.

Shared by HK Frontend (features/live_tv/stream.py) and Mantel Link (tv.py), whose views start it for go2rtc. Pure: it
only builds the argument list and names the decoder complaints that are harmless.
"""
from __future__ import annotations

BENIGN = ("Invalid frame dimensions 0x0", "Error submitting packet to decoder",
          "Last message repeated")
QUALITY = {
    # Broadcast HD is 1080i: yadif makes it progressive at 29.97 fps.
    "720": ["-vf", "yadif=0:-1:0,scale=-2:720",
            "-b:v", "3000k", "-maxrate", "3500k", "-bufsize", "3000k"],
    "1080": ["-vf", "yadif=0:-1:0",
             "-b:v", "6000k", "-maxrate", "7000k", "-bufsize", "6000k"],
}


def ffmpeg_args(url: str, quality: str) -> list[str]:
    return [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
        # FAST START: probe a second of the stream, not ffmpeg's default five,
        # and put a key frame every second so WebRTC can start on one soon.
        "-probesize", "1500000", "-analyzeduration", "1000000",
        "-fflags", "+genpts+discardcorrupt", "-i", url,
        "-map", "0:v:0", "-map", "0:a:0",
        *QUALITY.get(quality, QUALITY["720"]),
        "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
        "-profile:v", "high", "-level:v", "4.1", "-pix_fmt", "yuv420p",
        "-g", "30", "-keyint_min", "30",
        "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "48000",
        "-f", "mpegts", "-muxdelay", "0", "pipe:1",
    ]
