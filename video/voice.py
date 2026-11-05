"""Generates the voiceover sentence by sentence, joins it with hand-set pauses, and writes the timeline."""
import asyncio, json, subprocess, pathlib
import edge_tts

root = pathlib.Path(__file__).parent
script = json.loads((root / "script.json").read_text(encoding="utf-8"))
clips = root / "build" / "clips"
clips.mkdir(parents=True, exist_ok=True)
audio = root / "public" / "audio"
audio.mkdir(parents=True, exist_ok=True)

def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)], capture_output=True, text=True)
    return float(out.stdout.strip())

async def main():
    timeline, parts, t = [], [], 0.6  # a short breath before the first line
    silence = lambda s: f"anullsrc=r=24000:cl=mono:d={s}"
    lead = clips / "lead.wav"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", silence(0.6), str(lead)], check=True)
    parts.append(lead)
    n = 0
    for scene in script["scenes"]:
        start = t
        lines = []
        for text, pause in scene["lines"]:
            mp3 = clips / f"{n:02d}.mp3"
            for attempt in range(6):
                if mp3.exists() and mp3.stat().st_size > 2000:
                    break
                try:
                    await edge_tts.Communicate(text, script["voice"], rate=script["rate"]).save(str(mp3))
                except Exception as error:  # the service drops requests now and then
                    print("retry", n, attempt, type(error).__name__)
                    await asyncio.sleep(2 + attempt * 2)
            else:
                raise RuntimeError(f"No audio for line {n}")
            wav = clips / f"{n:02d}.wav"
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(mp3), "-ar", "24000", "-ac", "1", str(wav)], check=True)
            d = duration(wav)
            gap = clips / f"{n:02d}-gap.wav"
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", silence(pause), str(gap)], check=True)
            parts += [wav, gap]
            lines.append({"text": text, "start": round(t, 3), "end": round(t + d, 3)})
            t += d + pause
            n += 1
        timeline.append({"id": scene["id"], "start": round(start, 3), "end": round(t, 3), "lines": lines})
    listing = clips / "list.txt"
    listing.write_text("".join(f"file '{p.as_posix()}'\n" for p in parts), encoding="utf-8")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(listing), "-c:a", "pcm_s16le", str(audio / "voice.wav")], check=True)
    (root / "src").mkdir(exist_ok=True)
    (root / "src" / "timeline.json").write_text(json.dumps({"total": round(t, 3), "scenes": timeline}, indent=1), encoding="utf-8")
    print("total seconds", round(t, 2))
    for s in timeline:
        print(s["id"], s["start"], s["end"])

asyncio.run(main())
