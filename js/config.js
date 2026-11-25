// ---------------------------------------------------------------------------
// Merkezi yapılandırma. Bu dosya hiçbir şey import etmez; Node testleri de
// tarayıcı da aynı değerleri kullanır.
// ---------------------------------------------------------------------------

/**
 * ÖLÇEK SİSTEMİ (ayrıntılı açıklama README.md içinde)
 *
 *  - Sahne birimi: 1 birim = 1 gerçek (fiziksel) metre. WebXR tracking de
 *    metre cinsindendir, bu yüzden baş ve el pozları HİÇ ölçeklenmez.
 *  - Maket (model) birimi: 1:70 mimari maketin kendi metresi. Örnek sahne ve
 *    yüklenen .glb modelleri bu birimde tanımlanır (gerçek 3 m duvar = 3/70 m).
 *  - Görünüm ölçeği (viewScale): modelRoot grubuna uygulanan tek ölçek.
 *      viewScale = 70  -> "insan gözü" modu: maket gerçek boyuta büyütülür,
 *                         kullanıcı 1:70 maketin içinde 1.70 m'lik bir insan
 *                         gibi dolaşır.
 *      viewScale = 1   -> "maket" modu: maket fiziksel boyutunda (masa üstü).
 *  - Dönüşüm zinciri:
 *      dünya = rig(yaw, konum) · xrOffset · XRpose          (kullanıcı tarafı)
 *      dünya = modelRoot(viewScale) · maketKoordinatı        (model tarafı)
 */
export const SCALE = Object.freeze({
  MODEL_RATIO: 1 / 70,          // maket ölçeği
  REFERENCE_HUMAN_HEIGHT: 1.70, // m (gerçek)
  REFERENCE_EYE_HEIGHT: 1.60,   // m (gerçek)
  get SCALED_EYE_HEIGHT() {     // maket birimi cinsinden ≈ 0.02286
    return this.REFERENCE_EYE_HEIGHT * this.MODEL_RATIO;
  },
});

/** Seçilebilir görünüm modları. */
export const VIEW_MODES = Object.freeze({
  human: { id: 'human', label: '1:70 — insan gözü (maket ×70)', viewScale: 70 },
  model: { id: 'model', label: '1:1 — maket boyutu (masa üstü)', viewScale: 1 },
});

/** Hareket parametreleri. Hızlar "gerçek insan" ölçeğinde tanımlıdır. */
export const LOCOMOTION = Object.freeze({
  WALK_SPEED_REAL: 1.4,       // m/s, binanın gerçek ölçeğinde yürüme hızı
  WALK_RAMP_TIME: 0.12,       // s, 0 -> tam hız (bırakınca anında durur)
  TURN_SPEED_DEG: 60,         // derece/s
  TURN_RAMP_TIME: 0.25,       // s, yumuşak dönüş başlangıcı
  DESKTOP_EYE_HEIGHT: 1.60,   // m, yalnızca masaüstünde (tracking yokken)
  LOCAL_SPACE_EYE_OFFSET: 1.60, // m, 'local' fallback referans alanında zemin tahmini
});

/** Jest motoru eşikleri (el büyüklüğüne normalize oranlar). */
export const GESTURES = Object.freeze({
  // oran = |başparmak ucu - parmak ucu| / |bilek - orta parmak MCP|
  thresholds: {
    index: { press: 0.25, release: 0.36 },
    middle: { press: 0.25, release: 0.36 }, // eşlenmemiş, yalnızca engelleyici
    ring:  { press: 0.27, release: 0.38 },
    pinky: { press: 0.29, release: 0.40 },
  },
  activationMs: 60,         // pinch bu kadar süre tutulmadan aktifleşmez
  ambiguityMargin: 0.12,    // iki aday skoru bu kadar yakınsa: belirsiz -> hareket yok
  allowWalkWhileTurning: false, // false: dönüş yürümeye göre önceliklidir
  minHandSize: 1e-4,
});

/** Harici kütüphaneler: sabit sürümlü CDN adresleri. */
export const CDN = Object.freeze({
  MEDIAPIPE_VISION: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs',
  MEDIAPIPE_WASM: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
  HAND_MODEL: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
});
