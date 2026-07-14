"""PaddleOCR recognition on a Hailo NPU (HEF via HailoRT).

Drop-in BaseModelRunner for Frigate's LPR recognition stage: takes the
normalized (N, 3, 48, W) CHW batch the LPR mixin prepares, feeds the HEF one
crop at a time, and returns stacked (N, T, C) probabilities for the CTC
decoder. Enable with `lpr: device: Hailo`.

Requires a recognition HEF compiled for the local Hailo architecture and its
matching character dict (PP-OCRv5 mobile rec works well), placed at
PADDLE_OCR_HEF / PADDLE_OCR_DICT (override via env).
"""

import logging
import os
import threading

import numpy as np

from frigate.const import MODEL_CACHE_DIR
from frigate.detectors.detection_runners import BaseModelRunner

logger = logging.getLogger(__name__)

PADDLE_OCR_HEF = os.environ.get(
    "LPR_HAILO_HEF",
    os.path.join(
        MODEL_CACHE_DIR, "paddleocr-hailo", "paddle_ocr_v5_mobile_recognition.hef"
    ),
)
PADDLE_OCR_DICT = os.environ.get(
    "LPR_HAILO_DICT",
    os.path.join(MODEL_CACHE_DIR, "paddleocr-hailo", "ppocrv5_dict.txt"),
)


class HailoOCRRunner(BaseModelRunner):
    """Runs the PaddleOCR recognition HEF on a Hailo device."""

    def __init__(self, model_path: str = PADDLE_OCR_HEF, **kwargs):
        from hailo_platform import FormatType, HailoSchedulingAlgorithm, VDevice

        params = VDevice.create_params()
        params.scheduling_algorithm = HailoSchedulingAlgorithm.ROUND_ROBIN
        # share the NPU with the object detection VDevice
        params.group_id = "SHARED"
        self._vdevice = VDevice(params)
        self._model = self._vdevice.create_infer_model(model_path)
        for name in self._model.output_names:
            self._model.output(name).set_format_type(FormatType.FLOAT32)
        self._configured = self._model.configure()
        self._out_name = self._model.output_names[0]
        self._out_shape = self._model.output(self._out_name).shape
        in_shape = self._model.input().shape  # (H, W, 3)
        self._in_w = in_shape[1]
        self._lock = threading.Lock()
        logger.info(
            f"Hailo OCR ready: {model_path} in={tuple(in_shape)} out={tuple(self._out_shape)}"
        )

    def get_input_names(self) -> list[str]:
        return ["x"]

    def get_input_width(self) -> int:
        return self._in_w

    def run(self, input: dict[str, np.ndarray]) -> list[np.ndarray]:
        x = input["x"]  # (N, 3, H, W) float32, normalized to [-1, 1]
        imgs = ((x * 0.5 + 0.5) * 255.0).clip(0, 255).astype(np.uint8)
        imgs = imgs.transpose(0, 2, 3, 1)  # NCHW -> NHWC (RGB)
        outputs = []
        with self._lock:  # bindings are not thread-safe
            for img in imgs:  # HEF is compiled with batch size 1
                out = np.empty(self._out_shape, dtype=np.float32)
                bindings = self._configured.create_bindings()
                bindings.input().set_buffer(np.ascontiguousarray(img))
                bindings.output(self._out_name).set_buffer(out)
                self._configured.run([bindings], 10_000)
                outputs.append(out.reshape(-1, self._out_shape[-1]))
        return [np.stack(outputs)]
