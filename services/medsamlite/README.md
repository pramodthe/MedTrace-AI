# Swin-LiteMedSAM Basic Web App

Clean repo for one workflow:

1. Upload an image
2. Drag a box on canvas
3. Get Swin-LiteMedSAM mask overlay

## Included

- `app_basic.py` - FastAPI backend for segmentation
- `web/index.html` - lightweight frontend with click-and-drag box
- `swin_demo/inference_core.py` - Swin-LiteMedSAM inference core
- `third_party/Swin_LiteMedSAM/models` and `third_party/Swin_LiteMedSAM/visual_sampler` - required upstream model code
- `Swin_LiteMedSam/Swin_LiteMedSAM.pth` - checkpoint path (you already downloaded this)

## Install

```bash
cd /path/to/repo
python -m venv .venv
source .venv/bin/activate
pip install --upgrade pip setuptools wheel
pip install -e .
```

If needed, install the right PyTorch build first from [pytorch.org](https://pytorch.org/get-started/locally/).

## Run

```bash
python app_basic.py --device auto --host 127.0.0.1 --port 7870
```

Open: `http://127.0.0.1:7870`

## Notes

- Input expected: PNG/JPEG image.
- DICOM is not yet wired in this basic UI.
- GPU is optional; CPU works but slower.
