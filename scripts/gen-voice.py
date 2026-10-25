"""Pre-records the commentator (British male voice, Kokoro TTS) as small MP3 clips.

Usage: python gen-voice.py manifest.json out_dir kokoro.onnx voices.bin [workers]
The manifest is the JSON list printed by `npx tsx scripts/voice-manifest.ts`. Run it with Python 3
and the kokoro-onnx and soundfile packages, and ffmpeg. Writes
<out>/<n>.mp3 plus <out>/index.json mapping each clip's text to its file. Clips already
in index.json are kept, so re-running only records new phrases.
"""
import json, os, re, subprocess, sys, tempfile
from concurrent.futures import ProcessPoolExecutor

VOICE, SPEED = 'bm_george', 1.12
_k = None

def speakable(text):
    t = re.sub(r"^[\s.,!?’']+", '', text).replace('’', "'")
    return t or text

def render(job):
    global _k
    text, path, model, voices = job
    if _k is None:
        from kokoro_onnx import Kokoro
        _k = Kokoro(model, voices)
    import soundfile as sf
    samples, sr = _k.create(speakable(text), voice=VOICE, speed=SPEED, lang='en-gb')
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
        sf.write(f.name, samples, sr)
        wav = f.name
    # trim the silence around the clip, mono 24 kHz MP3
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-af',
                    'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse',
                    '-ac', '1', '-ar', '24000', '-b:a', '48k', path], check=True)
    os.unlink(wav)
    return text

def main():
    manifest, out, model, voices = sys.argv[1:5]
    workers = int(sys.argv[5]) if len(sys.argv) > 5 else 4
    os.makedirs(out, exist_ok=True)
    idx_path = os.path.join(out, 'index.json')
    index = json.load(open(idx_path)) if os.path.exists(idx_path) else {}
    texts = json.load(open(manifest))
    nxt = max([int(v) for v in index.values()] + [-1]) + 1
    jobs = []
    for t in texts:
        if t in index: continue
        index[t] = str(nxt)
        jobs.append((t, os.path.join(out, f'{nxt}.mp3'), model, voices)); nxt += 1
    with ProcessPoolExecutor(workers) as ex:
        for i, t in enumerate(ex.map(render, jobs)):
            if i % 20 == 0: print(f'{i + 1}/{len(jobs)} {t}', flush=True)
    json.dump(index, open(idx_path, 'w'), ensure_ascii=False, indent=0)
    print('done', len(jobs), 'new clips,', len(index), 'total')

if __name__ == '__main__':
    main()
