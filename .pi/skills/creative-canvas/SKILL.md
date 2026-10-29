---
name: creative-canvas
description: Build interactive Three.js 3D graphics, generative art (Canvas/P5.js), and 2D games/simulations, previewing them instantly via a local web server.
---

# Creative Canvas: Three.js, Generative Art & Games

Specialized skill for visual coding, 3D scenes, physics simulations, and generative art.

## Usage

```bash
# 1. Preview a static HTML5/Three.js file or directory
.pi/skills/creative-canvas/scripts/preview.sh index.html
.pi/skills/creative-canvas/scripts/preview.sh ./game-dir 8081

# 2. Stop a preview server when done
.pi/skills/creative-canvas/scripts/kill-preview.sh 8081
```

## Protocol
1. For Three.js or P5.js code, consult `.pi/work/docs/` first (via `libdocs`) to verify modern CDN URLs and import syntax.
2. Favor self-contained, elegant single-file HTML or minimal modules with standard ES imports.
3. Launch `preview.sh` and provide the user with the clickable `http://localhost:<port>` link.
