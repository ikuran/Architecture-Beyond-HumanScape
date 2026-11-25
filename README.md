# WebXR Manhattan

Lower Manhattan climate-resilience scene (flood, sea, sun, wind, past years, street life) combined with the Quest 3 hand-tracking locomotion kit.

## Run
1. Host this folder over **HTTPS** (e.g. GitHub Pages; `.nojekyll` is included). WebXR and the camera do not work over plain http except on localhost.
2. Quest 3: open the page in Quest Browser, choose year / storm / lighting in the panel (the VR scene mirrors them), press **Enter VR**.
3. Desktop: **Start camera hands** uses MediaPipe on your webcam to drive the first-person walk. Keyboard WASD / drag still work.

## Hand gestures
| Gesture | Action |
|---|---|
| thumb + index pinch | walk forward (direction = where you look) |
| thumb + pinky pinch | turn right |
| thumb + ring pinch | turn left |
| thumb + middle | ignored (blocks accidental pinches) |

## How the two projects were joined
- **True scale.** The city is 1 world metre = 1 real metre (the scene group is scaled 0.759 horizontally because model x/z are Web-Mercator units). VR is at human eye height, not a 1:70 maquette.
- **One three.js.** The city uses three r128; `js/three-shim.js` maps `import 'three'` to that global so the kit's modules run unchanged (`gestures.js`, `locomotion.js`, `hand-tracking.js`, `xr-manager.js`, `desktop-hands.js`; only user-facing strings were translated to English).
- **Rig.** `rig > xrSpace > camera`. Only the rig moves; poses are never scaled.
- **Collision.** Walking is blocked by building footprints and open water using the simulation's own grid.
- **VR spawn.** At the first-person spot you picked (or the current walk position); on exit the orbit camera returns there.
- 2D overlays (AR tags, minimap, panel) are hidden in VR; floating data boards, people, cars, sky, shadows and flood water stay.

## Tests
`npm test` runs the pure gesture/locomotion maths (33 tests). The scene and VR glue have only been smoke-tested with a stubbed three.js; **it has not been run on a real Quest 3 or in real WebGL.**

## Data and honesty notes
- Buildings: "Manhattan OSM Complete Model" by MENUDQ2, CC BY 4.0, from OpenStreetMap.
- Ground elevation is **synthetic**, not a survey DEM. Simulations are design hypotheses, not validated predictions.
- Original hand-tracking README is kept as `README.tr.md` (Turkish).
