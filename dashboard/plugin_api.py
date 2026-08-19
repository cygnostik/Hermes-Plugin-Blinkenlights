"""Tiny, passive telemetry API for the Blinkenbar desktop pane.

The endpoint does no background work. CPU, memory, disk and NVML counters are
sampled only when the visible desktop pane polls (normally every two seconds).
"""
from __future__ import annotations

import ctypes
import math
import ntpath
import os
import threading
import time
from ctypes import POINTER, Structure, byref, c_uint, c_ulonglong, c_void_p

import psutil
from fastapi import APIRouter

router = APIRouter()
_lock = threading.Lock()
_last_at = time.monotonic()
try:
    _last_io = psutil.disk_io_counters()
except Exception:  # telemetry must not prevent plugin import
    _last_io = None
try:
    psutil.cpu_percent(interval=None)
except Exception:  # the first endpoint sample will report degradation
    pass

LOAD_LIBRARY_SEARCH_SYSTEM32 = 0x00000800


def _unavailable_gpu(error: str) -> dict[str, float | int | bool | str]:
    return {
        "available": False,
        "util": 0.0,
        "memory": 0.0,
        "memory_used_mb": 0,
        "memory_total_mb": 0,
        "error": error,
    }


def _system32_nvml_path() -> str | None:
    """Return NVML's absolute OS-reported System32 path without environment input."""
    try:
        buffer = ctypes.create_unicode_buffer(32768)
        get_system_directory = getattr(ctypes, "windll").kernel32.GetSystemDirectoryW
        get_system_directory.argtypes = [ctypes.c_wchar_p, c_uint]
        get_system_directory.restype = c_uint
        length = int(get_system_directory(buffer, len(buffer)))
        if not 0 < length < len(buffer):
            return None
        directory = ntpath.normpath(buffer.value)
        if not ntpath.isabs(directory):
            return None
        return ntpath.join(directory, "nvml.dll")
    except Exception:
        return None


class _NvmlUtilization(Structure):
    _fields_ = [("gpu", c_uint), ("memory", c_uint)]


class _NvmlMemory(Structure):
    _fields_ = [("total", c_ulonglong), ("free", c_ulonglong), ("used", c_ulonglong)]


class _NvmlProbe:
    """Minimal direct NVML binding; avoids a subprocess or extra package."""

    def __init__(self) -> None:
        self.dll = None
        self.handle = c_void_p()
        self.error = "NVML unavailable"
        if os.name != "nt":
            self.error = "NVML probe currently targets Windows"
            return
        candidate = _system32_nvml_path()
        if candidate is None:
            self.error = "Windows system directory unavailable"
            return
        try:
            dll = ctypes.WinDLL(candidate, winmode=LOAD_LIBRARY_SEARCH_SYSTEM32)
            dll.nvmlInit_v2.restype = c_uint
            dll.nvmlDeviceGetHandleByIndex_v2.argtypes = [c_uint, POINTER(c_void_p)]
            dll.nvmlDeviceGetHandleByIndex_v2.restype = c_uint
            dll.nvmlDeviceGetUtilizationRates.argtypes = [c_void_p, POINTER(_NvmlUtilization)]
            dll.nvmlDeviceGetUtilizationRates.restype = c_uint
            dll.nvmlDeviceGetMemoryInfo.argtypes = [c_void_p, POINTER(_NvmlMemory)]
            dll.nvmlDeviceGetMemoryInfo.restype = c_uint
            rc = int(dll.nvmlInit_v2())
            if rc:
                self.error = f"NVML init {rc}"
                return
            rc = int(dll.nvmlDeviceGetHandleByIndex_v2(0, byref(self.handle)))
            if rc:
                self.error = f"NVML device {rc}"
                return
            self.dll = dll
            self.error = ""
        except Exception:  # hardware/driver availability is optional
            self.error = "NVML unavailable in Windows system directory"

    def sample(self) -> dict[str, float | int | bool | str]:
        if self.dll is None:
            return _unavailable_gpu(self.error)
        utilization = _NvmlUtilization()
        memory = _NvmlMemory()
        rc_util = int(self.dll.nvmlDeviceGetUtilizationRates(self.handle, byref(utilization)))
        rc_mem = int(self.dll.nvmlDeviceGetMemoryInfo(self.handle, byref(memory)))
        if rc_util or rc_mem:
            return _unavailable_gpu(f"NVML query {rc_util}/{rc_mem}")
        memory_pct = (float(memory.used) / float(memory.total) * 100.0) if memory.total else 0.0
        return {
            "available": True,
            "util": round(float(utilization.gpu), 1),
            "memory": round(memory_pct, 1),
            "memory_used_mb": round(float(memory.used) / 1048576.0),
            "memory_total_mb": round(float(memory.total) / 1048576.0),
            "error": "",
        }


_nvml = _NvmlProbe()


def _disk_sample(now: float) -> dict[str, float | int]:
    global _last_at, _last_io
    current = psutil.disk_io_counters()
    elapsed = max(0.05, now - _last_at)
    if current is None or _last_io is None:
        _last_at, _last_io = now, current
        return {"activity": 0.0, "read_bps": 0, "write_bps": 0}

    read_bps = max(0.0, float(current.read_bytes - _last_io.read_bytes) / elapsed)
    write_bps = max(0.0, float(current.write_bytes - _last_io.write_bytes) / elapsed)
    busy_now = getattr(current, "busy_time", 0)
    busy_then = getattr(_last_io, "busy_time", 0)
    busy_pct = max(0.0, float(busy_now - busy_then) / (elapsed * 10.0))

    # Some Windows drivers do not expose busy_time. A deliberately conservative
    # byte-rate fallback gives movement without pretending throughput is usage.
    if busy_pct <= 0.0 and read_bps + write_bps > 0.0:
        busy_pct = min(100.0, math.sqrt((read_bps + write_bps) / 500_000_000.0) * 100.0)

    _last_at, _last_io = now, current
    return {
        "activity": round(min(100.0, busy_pct), 1),
        "read_bps": round(read_bps),
        "write_bps": round(write_bps),
    }


@router.get("/metrics")
async def metrics():
    with _lock:
        now = time.monotonic()
        errors: list[str] = []
        try:
            cpu = round(float(psutil.cpu_percent(interval=None)), 1)
        except Exception:
            cpu = 0.0
            errors.append("cpu")
        try:
            memory_sample = psutil.virtual_memory()
            memory = round(float(memory_sample.percent), 1)
            memory_used_gb = round(float(memory_sample.used) / 1073741824.0, 2)
            memory_total_gb = round(float(memory_sample.total) / 1073741824.0, 2)
        except Exception:
            memory = 0.0
            memory_used_gb = 0.0
            memory_total_gb = 0.0
            errors.append("memory")
        try:
            disk = _disk_sample(now)
        except Exception:
            disk = {"activity": 0.0, "read_bps": 0, "write_bps": 0}
            errors.append("io")
        try:
            gpu = _nvml.sample()
        except Exception:
            gpu = _unavailable_gpu("GPU telemetry unavailable")
            errors.append("gpu")
        return {
            "ok": not errors,
            "degraded": bool(errors),
            "errors": errors,
            "sampled_at": time.time(),
            "cpu": cpu,
            "memory": memory,
            "memory_used_gb": memory_used_gb,
            "memory_total_gb": memory_total_gb,
            "io": disk,
            "gpu": gpu,
        }
