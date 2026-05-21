# Stable Audio 3 research notes

Source: <https://stability.ai/news-updates/meet-stable-audio-3-the-model-family-built-for-artistic-experimentation-with-open-weight-models>

## What Stability announced

- Stable Audio 3.0 is a family of latent-diffusion audio models trained on licensed / Creative Commons data.
- Small and Medium are open-weight and hosted on Hugging Face; Large is API / enterprise self-hosting.
- Models:
  - `stabilityai/stable-audio-3-small-sfx` — sound effects on-device / consumer laptops.
  - `stabilityai/stable-audio-3-small-music` — full music composition on-device.
  - `stabilityai/stable-audio-3-medium` — better musicality and long-form generation up to about 6:20 / 380 seconds.
  - `stabilityai/stable-audio-3-optimized` — public optimized repo with MLX, ONNX, TensorRT assets.
- Official GitHub model table reports runtime-facing model sizes / limits:
  - Small SFX: 433M params, CPU / CoreML capable, max 120s.
  - Small Music: 433M params, CPU / CoreML capable, max 120s.
  - Medium: 1.4B params, CUDA/TensorRT path, max 380s.
- Hugging Face API metadata shows larger total repo parameter counts including bundled text-conditioning / related assets: ~567.6M for small repos and ~2.305B for medium.
- Hugging Face gates the standard small/medium repos behind Stability's Community License plus Gemma terms. The optimized repo is not gated, but it is described as experimental.

## Fit for Paul's machine

This MacBook Pro is an Apple M4 Max with 128GB unified memory and a 40-core GPU. Stability's own docs list Mac CPU/CoreML performance for the small models: 5s audio in ~0.70s CPU / ~0.23s CoreML, 30s in ~1.72s CPU / ~0.63s CoreML, and 120s in ~5.92s CPU / ~3.09s CoreML. So: yes, this machine should run the small Music/SFX models very well. Medium is documented mainly for CUDA/TensorRT with ~5–6.5GB peak VRAM on H200; on this Mac it may need the optimized MLX/CoreML path to be pleasant, so treat Medium-on-Mac as experimental until Stability's Apple path settles.

## Practical setup notes

1. Accept the gated model license on Hugging Face for the standard repos.
2. Export `HF_TOKEN` or run `huggingface-cli login` in the Python environment.
3. Install the official `stable-audio-3` library when ready. This repo's UI already has a Python bridge, but defaults to mock mode so the interface is usable before ML deps are installed.
4. Start with `small-sfx` for SFX and `small-music` for musical sketches; switch to `medium` for longer / more coherent tracks.

## License note

The Stability AI Community License allows output ownership and distribution/commercialization under its terms. Organizations above $1M annual revenue need an Enterprise License. Gemma terms also apply because SA3 uses T5Gemma for text conditioning.
