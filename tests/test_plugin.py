from __future__ import annotations

import asyncio
import importlib.util
import json
import unittest
from pathlib import Path
from unittest import mock

from dashboard import plugin_api

ROOT = Path(__file__).resolve().parents[1]


class PluginApiTests(unittest.TestCase):
    def test_metrics_payload_shape(self) -> None:
        payload = asyncio.run(plugin_api.metrics())
        self.assertTrue(payload["ok"])
        self.assertGreater(payload["sampled_at"], 0)
        self.assertGreaterEqual(payload["cpu"], 0)
        self.assertLessEqual(payload["cpu"], 100)
        self.assertGreaterEqual(payload["memory"], 0)
        self.assertLessEqual(payload["memory"], 100)
        self.assertEqual({"activity", "read_bps", "write_bps"}, set(payload["io"]))
        self.assertIn("available", payload["gpu"])

    def test_metrics_route_is_registered(self) -> None:
        routes = {
            (getattr(route, "path", ""), tuple(getattr(route, "methods", ()) or ()))
            for route in plugin_api.router.routes
        }
        self.assertIn(("/metrics", ("GET",)), routes)

    def test_metrics_degrades_component_failures_without_raising(self) -> None:
        cases = {
            "cpu": mock.patch.object(plugin_api.psutil, "cpu_percent", side_effect=OSError("cpu failed")),
            "memory": mock.patch.object(plugin_api.psutil, "virtual_memory", side_effect=OSError("memory failed")),
            "io": mock.patch.object(plugin_api, "_disk_sample", side_effect=OSError("disk failed")),
            "gpu": mock.patch.object(plugin_api._nvml, "sample", side_effect=OSError("gpu failed")),
        }
        for component, failure in cases.items():
            with self.subTest(component=component), failure:
                payload = asyncio.run(plugin_api.metrics())
                self.assertFalse(payload["ok"])
                self.assertTrue(payload["degraded"])
                self.assertEqual([component], payload["errors"])
                self.assertEqual(
                    {"ok", "degraded", "errors", "sampled_at", "cpu", "memory", "memory_used_gb", "memory_total_gb", "io", "gpu"},
                    set(payload),
                )
                self.assertEqual({"activity", "read_bps", "write_bps"}, set(payload["io"]))
                self.assertEqual(
                    {"available", "util", "memory", "memory_used_mb", "memory_total_mb", "error"},
                    set(payload["gpu"]),
                )

    def test_nvml_loader_has_no_search_path_fallback(self) -> None:
        source = (ROOT / "dashboard" / "plugin_api.py").read_text(encoding="utf-8")
        self.assertNotIn('Path("nvml.dll")', source)
        self.assertNotIn("Path('nvml.dll')", source)
        self.assertNotIn("os.environ.get(\"WINDIR\"", source)
        self.assertIn("LOAD_LIBRARY_SEARCH_SYSTEM32", source)

    def test_nvml_loader_uses_only_trusted_absolute_path_and_safe_mode(self) -> None:
        trusted_path = r"C:\Windows\System32\nvml.dll"
        dll = mock.MagicMock()
        dll.nvmlInit_v2.return_value = 1
        with (
            mock.patch.object(plugin_api.os, "name", "nt"),
            mock.patch.object(plugin_api, "_system32_nvml_path", return_value=trusted_path),
            mock.patch.object(plugin_api.ctypes, "WinDLL", return_value=dll, create=True) as loader,
        ):
            plugin_api._NvmlProbe()
        loader.assert_called_once_with(trusted_path, winmode=plugin_api.LOAD_LIBRARY_SEARCH_SYSTEM32)

    def test_registers_no_agent_tools(self) -> None:
        spec = importlib.util.spec_from_file_location("blinkenbar_agent_plugin", ROOT / "__init__.py")
        self.assertIsNotNone(spec)
        assert spec is not None
        module = importlib.util.module_from_spec(spec)
        assert spec.loader
        spec.loader.exec_module(module)
        context = object()
        self.assertIsNone(module.register(context))

    def test_dashboard_manifest_matches_package(self) -> None:
        manifest = json.loads((ROOT / "dashboard" / "manifest.json").read_text(encoding="utf-8"))
        metadata = (ROOT / "plugin.yaml").read_text(encoding="utf-8")
        version = next(
            line.split(":", 1)[1].strip().strip('"').strip("'")
            for line in metadata.splitlines()
            if line.startswith("version:")
        )
        self.assertEqual("blinkenbar", manifest["name"])
        self.assertEqual(version, manifest["version"])
        self.assertIn("manifest_version: 1", metadata)
        self.assertIn("license: MIT", metadata)


if __name__ == "__main__":
    unittest.main()
