# Third-Party Notices

Blinkenbar does not vendor third-party source or binary dependencies in this repository. It interoperates with the following software supplied by the host environment or operating system. The applicable versions and license texts are those distributed with those components.

## Runtime interfaces

| Component | Use | Bundled here? | License/source |
|---|---|---:|---|
| Hermes Desktop and `@hermes/plugin-sdk` | Plugin lifecycle, UI contributions, gateway events, scoped storage and REST | No | See the Hermes distribution and its official notices |
| React and `react/jsx-runtime` | Desktop component rendering, supplied by Hermes | No | MIT; https://react.dev/ |
| FastAPI | Namespaced local metrics endpoint | No | MIT; https://fastapi.tiangolo.com/ |
| psutil | Cross-platform aggregate system counters | No | BSD-3-Clause; https://github.com/giampaolo/psutil |
| NVIDIA Management Library (NVML) | Optional Windows GPU counters, dynamically loaded from an installed driver | No | NVIDIA driver terms; https://developer.nvidia.com/management-library-nvml |
| Python standard library | Backend implementation | No | Python Software Foundation License; https://docs.python.org/3/license.html |

No third-party fonts, images, video, audio, JavaScript bundles, analytics SDKs, or model assets are included.

## Visual inspiration

The blinkenlight visual direction was inspired by a demonstration by Boz Brown: https://www.youtube.com/watch?v=vKjqw5iGqnQ. No content from the video is bundled or represented as licensed material. Boz Brown is not affiliated with, a contributor to, or an endorser of Blinkenbar.

This notice is informational and is not a substitute for the license notices shipped by each dependency. Before a release, verify exact dependency versions and reproduce all notices required by the distribution method.
