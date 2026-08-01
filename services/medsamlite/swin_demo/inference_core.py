"""
Inference helpers for Swin-LiteMedSAM (upstream logic from infer.py).
Adds sys.path to third_party/Swin_LiteMedSAM; fixes device handling in medsam_inference.
"""

from __future__ import annotations

import sys
import warnings
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

warnings.filterwarnings("ignore")

_SWIN_ROOT = Path(__file__).resolve().parent.parent / "third_party" / "Swin_LiteMedSAM"
if str(_SWIN_ROOT) not in sys.path:
    sys.path.insert(0, str(_SWIN_ROOT))

from models import MaskDecoder_Prompt, PromptEncoder, SwinTransformer, TwoWayTransformer
from visual_sampler.config import cfg
from visual_sampler.sampler_v2 import build_shape_sampler

torch.set_float32_matmul_precision("high")


def resize_longest_side(image: np.ndarray, target_length: int = 256) -> np.ndarray:
    oldh, oldw = image.shape[0], image.shape[1]
    scale = target_length * 1.0 / max(oldh, oldw)
    newh, neww = int(oldh * scale + 0.5), int(oldw * scale + 0.5)
    return cv2.resize(image, (neww, newh), interpolation=cv2.INTER_AREA)


def pad_image(image: np.ndarray, target_size: int = 256) -> np.ndarray:
    h, w = image.shape[0], image.shape[1]
    padh = target_size - h
    padw = target_size - w
    if len(image.shape) == 3:
        return np.pad(image, ((0, padh), (0, padw), (0, 0)))
    return np.pad(image, ((0, padh), (0, padw)))


class MedSAM_Lite(nn.Module):
    def __init__(self, image_encoder, mask_decoder, prompt_encoder):
        super().__init__()
        self.image_encoder = image_encoder
        self.mask_decoder = mask_decoder
        self.prompt_encoder = prompt_encoder

    def forward(self, image, points, boxes, masks, tokens):
        image_embedding, fs = self.image_encoder(image)
        with torch.no_grad():
            boxes = torch.as_tensor(boxes, dtype=torch.float32, device=image.device)
            if len(boxes.shape) == 2:
                boxes = boxes[:, None, :]

        sparse_embeddings, dense_embeddings = self.prompt_encoder(
            points=points, boxes=boxes, masks=masks, tokens=tokens,
        )
        low_res_masks, iou_predictions = self.mask_decoder(
            fs,
            image_embeddings=image_embedding,
            image_pe=self.prompt_encoder.get_dense_pe(),
            sparse_prompt_embeddings=sparse_embeddings,
            dense_prompt_embeddings=dense_embeddings,
            multimask_output=False,
        )
        return low_res_masks

    @torch.no_grad()
    def postprocess_masks(self, masks, new_size, original_size):
        masks = masks[..., : new_size[0], : new_size[1]]
        return F.interpolate(
            masks,
            size=(original_size[0], original_size[1]),
            mode="bilinear",
            align_corners=False,
        )


def resize_box_to_256(box: np.ndarray, original_size: tuple[int, int]):
    new_box = np.zeros_like(box)
    ratio = 256 / max(original_size)
    for i in range(len(box)):
        new_box[i] = int(box[i] * ratio)
    return new_box, ratio


def get_points_256(box, gt2D: np.ndarray):
    gt2D = np.mean(gt2D, axis=-1)
    if len(box) == 1:
        x_min, y_min, x_max, y_max = box[0]
    else:
        x_min, y_min, x_max, y_max = box

    try:
        bounder_shiftx = np.random.randint(
            int((x_max - x_min) / 5), int(2 * (x_max - x_min) / 4) - 1, (1,)
        )
        bounder_shiftx = int(bounder_shiftx.item())
    except Exception:
        bounder_shiftx = 0
    try:
        bounder_shifty = np.random.randint(
            int((y_max - y_min) / 5), int(2 * (y_max - y_min) / 4) - 1, (1,)
        )
        bounder_shifty = int(bounder_shifty.item())
    except Exception:
        bounder_shifty = 0

    mid_x = int((x_min + x_max) // 2)
    mid_y = int((y_min + y_max) // 2)
    x_min = int(x_min + bounder_shiftx)
    x_max = int(x_max - bounder_shiftx)
    y_min = int(y_min + bounder_shifty)
    y_max = int(y_max - bounder_shifty)
    cl = [
        [y_min, mid_y, x_min, mid_x],
        [mid_y, y_max, x_min, mid_x],
        [mid_y, y_max, mid_x, x_max],
        [y_min, mid_y, mid_x, x_max],
    ]

    coords = []
    for i in range(4):
        gt2D_tmp = np.zeros((256, 256))
        gt2D_tmp[cl[i][0] : cl[i][1], cl[i][2] : cl[i][3]] = gt2D[
            cl[i][0] : cl[i][1], cl[i][2] : cl[i][3]
        ]
        y_indices, x_indices = np.where(gt2D_tmp > 0)
        if y_indices.size == 0:
            coords.append([mid_x, mid_y])
        else:
            x_point = np.random.choice(x_indices)
            y_point = np.random.choice(y_indices)
            coords.append([x_point, y_point])
    coords = np.array(coords).reshape(4, 2)
    return torch.tensor(coords).float()


def get_scribble_256(box, gt2D: np.ndarray):
    gt2D = np.mean(gt2D, axis=-1)
    shape_sampler = build_shape_sampler(cfg)

    if len(box) == 1:
        x_min, y_min, x_max, y_max = box[0]
    else:
        x_min, y_min, x_max, y_max = box

    try:
        bounder_shiftx = np.random.randint(
            int((x_max - x_min) / 8), int((x_max - x_min) / 6), (1,)
        )
        bounder_shiftx = bounder_shiftx.item()
    except Exception:
        bounder_shiftx = 0
    try:
        bounder_shifty = np.random.randint(
            int((y_max - y_min) / 8), int((y_max - y_min) / 6), (1,)
        )
        bounder_shifty = bounder_shifty.item()
    except Exception:
        bounder_shifty = 0

    x_min = int(x_min + bounder_shiftx)
    x_max = int(x_max - bounder_shiftx)
    y_min = int(y_min + bounder_shifty)
    y_max = int(y_max - bounder_shifty)
    gt2D_tmp = np.zeros((256, 256))
    gt2D_tmp[y_min:y_max, x_min:x_max] = gt2D[y_min:y_max, x_min:x_max]
    gt2D_tmp = np.uint8(gt2D_tmp > 0)
    gt2D_tmp[gt2D_tmp > 0] = 1

    masks = shape_sampler(gt2D_tmp).squeeze().unsqueeze(0).numpy()
    return torch.tensor(masks).float()


@torch.no_grad()
def medsam_inference(medsam_model, img_embed, fs, points_256, box_256, scribble_256, new_size, original_size):
    dev = img_embed.device
    box_torch = torch.as_tensor(box_256[None, None, ...], dtype=torch.float, device=dev)
    points_256 = points_256[None, ...].to(dev)
    labels_torch = torch.ones(points_256.shape[0], dtype=torch.long, device=dev)
    labels_torch = labels_torch.unsqueeze(1).expand(-1, 4)
    point_prompt = (points_256, labels_torch)
    scribble = scribble_256[None, ...].to(dev)

    sparse_embeddings, dense_embeddings = medsam_model.prompt_encoder(
        points=point_prompt,
        boxes=box_torch,
        masks=scribble,
        tokens=None,
    )

    low_res_logits, iou = medsam_model.mask_decoder(
        fs,
        image_embeddings=img_embed,
        image_pe=medsam_model.prompt_encoder.get_dense_pe(),
        sparse_prompt_embeddings=sparse_embeddings,
        dense_prompt_embeddings=dense_embeddings,
        multimask_output=False,
    )

    low_res_pred = medsam_model.postprocess_masks(low_res_logits, new_size, original_size)
    low_res_pred = torch.sigmoid(low_res_pred)
    low_res_pred = low_res_pred.squeeze().cpu().numpy()
    medsam_seg = (low_res_pred > 0.5).astype(np.uint8)
    return medsam_seg, iou


def build_model(checkpoint_path: str | Path, device: torch.device) -> MedSAM_Lite:
    medsam_lite_image_encoder = SwinTransformer()
    medsam_lite_prompt_encoder = PromptEncoder(
        embed_dim=256,
        image_embedding_size=(64, 64),
        input_image_size=(256, 256),
        mask_in_chans=16,
    )
    medsam_lite_mask_decoder = MaskDecoder_Prompt(
        num_multimask_outputs=3,
        transformer=TwoWayTransformer(
            depth=2, embedding_dim=256, mlp_dim=2048, num_heads=8,
        ),
        transformer_dim=256,
        iou_head_depth=3,
        iou_head_hidden_dim=256,
    )
    model = MedSAM_Lite(
        image_encoder=medsam_lite_image_encoder,
        mask_decoder=medsam_lite_mask_decoder,
        prompt_encoder=medsam_lite_prompt_encoder,
    )
    ckpt = torch.load(checkpoint_path, map_location="cpu")
    try:
        model.load_state_dict(ckpt)
    except Exception:
        model.load_state_dict(ckpt["model"])
    model.to(device)
    model.eval()
    return model


def ensure_uint8_rgb(img: np.ndarray) -> np.ndarray:
    if img.dtype != np.uint8:
        img = np.clip(np.asarray(img, dtype=np.float64), 0, 255)
        img = np.round(img).astype(np.uint8)
    if img.ndim == 2:
        img = np.repeat(img[:, :, None], 3, axis=-1)
    elif img.shape[-1] == 4:
        img = img[:, :, :3]
    return img


def predict_mask_from_box(
    model: MedSAM_Lite,
    img_hwc: np.ndarray,
    box_xyxy: tuple[float, float, float, float],
    device: torch.device,
    seed: int = 42,
) -> tuple[np.ndarray, np.ndarray]:
    """
    box_xyxy: (x_min, y_min, x_max, y_max) in original image pixel coordinates.
    Returns (binary_mask HxW uint8, overlay_rgb HxWx3 uint8).
    """
    np.random.seed(seed)
    torch.manual_seed(seed)

    img_3c = ensure_uint8_rgb(np.asarray(img_hwc))
    H, W = img_3c.shape[:2]
    box = np.array(
        [box_xyxy[0], box_xyxy[1], box_xyxy[2], box_xyxy[3]], dtype=np.float64
    )
    box[0] = np.clip(box[0], 0, W - 1)
    box[2] = np.clip(box[2], 0, W - 1)
    box[1] = np.clip(box[1], 0, H - 1)
    box[3] = np.clip(box[3], 0, H - 1)
    if box[2] <= box[0] or box[3] <= box[1]:
        raise ValueError("Invalid box: need x_max > x_min and y_max > y_min within image bounds.")

    img_256 = resize_longest_side(img_3c, 256)
    newh, neww = img_256.shape[:2]
    img_256_norm = (img_256 - img_256.min()) / np.clip(
        img_256.max() - img_256.min(), a_min=1e-8, a_max=None
    )
    img_256_padded = pad_image(img_256_norm, 256)
    img_256_tensor = (
        torch.tensor(img_256_padded).float().permute(2, 0, 1).unsqueeze(0).to(device)
    )

    with torch.no_grad():
        image_embedding, fs = model.image_encoder(img_256_tensor)

    box256, _ = resize_box_to_256(box, original_size=(H, W))
    box256 = box256[None, ...]
    points256 = get_points_256(box256, img_256_padded).to(device)
    scribble_256 = get_scribble_256(box256, img_256_padded)

    medsam_mask, _ = medsam_inference(
        model, image_embedding, fs, points256, box256, scribble_256, (newh, neww), (H, W)
    )

    overlay = img_3c.copy().astype(np.float32)
    color = np.array([30, 255, 80], dtype=np.float32)
    m = medsam_mask.astype(bool)
    alpha = 0.45
    overlay[m] = overlay[m] * (1 - alpha) + color * alpha
    overlay = np.clip(overlay, 0, 255).astype(np.uint8)

    return medsam_mask.astype(np.uint8), overlay
