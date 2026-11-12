"""Places each narration WAV at its start time on one silent track (mono, 16-bit).

Usage: python3 -I mix.py voice.json voice.wav
voice.json: {"total": seconds, "events": [{"start": seconds, "file": "x.wav"}]}
"""
import array
import json
import sys
import wave

spec = json.load(open(sys.argv[1]))
events = spec["events"]
with wave.open(events[0]["file"]) as first:
    rate, width, channels = first.getframerate(), first.getsampwidth(), first.getnchannels()
assert width == 2 and channels == 1, "espeak-ng gera WAV mono de 16 bits"
track = array.array("h", bytes(int(spec["total"] * rate + rate) * 2))
for event in events:
    with wave.open(event["file"]) as clip:
        if clip.getframerate() != rate:
            raise SystemExit("taxas diferentes entre as falas")
        samples = array.array("h", clip.readframes(clip.getnframes()))
    start = int(event["start"] * rate)
    end = min(len(track), start + len(samples))
    for i in range(start, end):
        value = track[i] + samples[i - start]
        track[i] = max(-32768, min(32767, value))
with wave.open(sys.argv[2], "wb") as output:
    output.setnchannels(1)
    output.setsampwidth(2)
    output.setframerate(rate)
    output.writeframes(track.tobytes())
