# WebXR Quest 3: El Takipli VR Gezinti (1:70 Ölçek)

1:70 ölçekli bir mimari maketin içinde **insan gözüyle**, **kontrolcü kullanmadan**, yalnızca el hareketleriyle dolaşmanı sağlayan statik bir WebXR projesi.

- **Quest 3:** Quest Browser'da açıp **Enter VR**'a basarsın. Gezinti native WebXR Hand Tracking ile yapılır.
- **Masaüstü:** **Start Camera** ile webcam açılır ve eller MediaPipe Hand Landmarker ile takip edilir.
- İki takip sistemi de **aynı jest motorunu** (`js/gestures.js`) ve **aynı hareket sistemini** (`js/locomotion.js`) kullanır.
- Backend, sunucu ya da build adımı gerekmez. Proje GitHub Pages'te (HTTPS) olduğu gibi çalışır.

> **Doğrulama durumu:** Bu proje **gerçek bir Meta Quest 3 cihazında test edilmedi.** Neyin nasıl test edildiği aşağıdaki [Testler](#testler) bölümünde açıkça yazıyor.

---

## Kontroller

| El hareketi | İşlev |
|---|---|
| Başparmak + işaret parmağı pinch | İleri yürüme (başın baktığı yatay yönde) |
| Başparmak + serçe parmak pinch | Sağa dönüş (dünya Y ekseni etrafında) |
| Başparmak + yüzük parmağı pinch | Sola dönüş (dünya Y ekseni etrafında) |
| Pinch yok, el kayıp ya da el kameradan çıktı | Hareket hemen durur |
| Başparmak + orta parmak | Hiçbir işleve bağlı değil, bilerek yok sayılır (aşağıya bak) |

İki el de takip edilir ve hangi elle jest yapıldığı fark etmez.

**Masaüstü hata ayıklama kısayolları:** `W`/`↑` ileri, `A`/`←` sola, `D`/`→` sağa, `R` konumu sıfırlar. Fareyle sürükleyerek etrafa bakabilirsin (bu yalnızca bakışı değiştirir, yürüyüş yine yatay kalır).

## Dosya yapısı

```text
webxr-quest3/
├── index.html            # import map (sabit sürümlü CDN), arayüz, debug paneli
├── .nojekyll             # GitHub Pages'te Jekyll işlemini kapatır
├── package.json          # yalnızca `npm test` için (bağımlılık yok, build yok)
├── css/style.css
├── js/
│   ├── main.js           # sahne grafiği, render döngüsü, arayüz, yaşam döngüsü
│   ├── config.js         # ölçek, hız, jest eşikleri, CDN adresleri
│   ├── xr-manager.js     # immersive-vr oturumu, referans alanı fallback'i
│   ├── hand-tracking.js  # Quest 3 WebXR joint pozları → HandFrame
│   ├── desktop-hands.js  # MediaPipe Hand Landmarker (webcam) → HandFrame
│   ├── gestures.js       # ortak jest motoru (bağımlılıksız, test edilebilir)
│   ├── locomotion.js     # yürüme ve dönüş (bağımlılıksız saf matematik)
│   ├── scene.js          # örnek 1:70 mimari sahne + .glb/.gltf yükleyici
│   └── hud.js            # VR içinde küçük durum göstergesi
├── assets/models/        # kendi .glb/.gltf modellerin buraya
└── tests/
    ├── gestures.test.js
    ├── locomotion.test.js
    └── e2e/smoke.mjs     # isteğe bağlı tarayıcı duman testi (Playwright + IWER)
```

Kütüphaneler (sabit sürümler, jsDelivr):

- `three@0.170.0`: `three` ve `three/addons/`
- `@mediapipe/tasks-vision@0.10.14`: yalnızca Start Camera'ya basılınca dinamik olarak yüklenir, Quest'te hiç indirilmez
- El modeli: `hand_landmarker.task` (float16/1, Google Storage)

---

## 1:70 ölçek: yöntem ve matematik

### Temel sorun

WebXR, Quest 3'ün baş ve el pozlarını **gerçek dünya metresi** cinsinden verir. Kafanı fiziksel olarak 10 cm oynattığında poz da 10 cm değişir. Sahneyi 1/70 ile küçültüp kamerayı olduğu gibi bırakırsan, 1.60 m yükseklikteki gözün 2.3 cm'lik maketin çok üstünde kalır. Head pose'u 1/70 ile çarparsan da gerçek baş takibi bozulur: her baş hareketi 70 kat küçülür ve stereo derinlik algısıyla çelişir. Spesifikasyon bunu açıkça yasaklıyor ve bu proje de bunu yapmıyor.

### Çözüm: birbirinden ayrı dört kavram, tek bir dönüşüm

| Kavram | Birim | Nerede |
|---|---|---|
| **Sahne/dünya birimi** | 1 birim = 1 fiziksel metre (WebXR ile aynı) | tüm sahne |
| **Model (maket) birimi** | 1:70 maketin kendi metresi | `modelRoot` içindeki her şey |
| **Kullanıcının göz yüksekliği** | Quest'in `local-floor` pozu, ölçeklenmez | `rig → xrSpace → camera` |
| **Görünüm ölçeği (`viewScale`)** | boyutsuz | yalnızca `modelRoot.scale` |

```
scene
├── modelRoot   scale = viewScale (70 = insan gözü, 1 = masa üstü maket)
│   ├── ground + 1 m grid
│   └── mimari (örnek sahne ya da .glb)       ← maket biriminde
└── rig         konum (x, z) + yaw, ölçek her zaman 1   ← locomotion yalnızca bunu değiştirir
    └── xrSpace WebXR referans uzayı ('local' fallback'inde y ofseti)
        ├── camera   ← poz doğrudan XR head pose'dan gelir, dokunulmaz
        │   └── HUD
        └── el eklemleri (InstancedMesh)
```

Dönüşüm zinciri:

```
dünya_noktası(model)     = S(viewScale) · p_maket
dünya_noktası(kullanıcı) = T(rig.xz) · R_y(rig.yaw) · T(xrSpace) · XRPose
```

Ölçek **yalnızca modelin tarafında** uygulanır. Kullanıcının tarafında (rig, xrSpace, camera, eller) hiçbir ölçek yoktur. Bu yüzden Quest'in baş ve el hareketleri birebir korunur.

### Sayılar

- Ölçek oranı: `1 / 70`
- Referans insan boyu: 1.70 m. Referans göz yüksekliği: 1.60 m.
- Maket biriminde göz yüksekliği: `1.60 / 70 ≈ 0.02286` (22.9 mm)
- **İnsan gözü modu (`viewScale = 70`):** maket 70 kat büyütülür. Gerçek gözün `local-floor`'dan ~1.60 m yükseklikte olduğunda maket koordinatında `1.60 / 70 = 0.02286`'ya denk gelir. Yani 1:70 maketin içinde tam olarak 1.60 m göz yüksekliğindeki bir insanın perspektifini görürsün. Ayrıca bir "kamera yüksekliği" sabiti zorlanmaz: eğilirsen ya da çömelirsen maketin içinde de eğilir ya da çömelirsin.
- **Maket modu (`viewScale = 1`):** maket fiziksel boyutundadır. Bina 16 m yerine 23 cm olur ve maketi masa üstündeki gibi tepeden görürsün. Bu mod ölçek mantığını doğrulamak için var.
- Mod değişince kullanıcının maket içindeki konumu korunur: başın dünya x/z'si `viewScale_yeni / viewScale_eski` ile çarpılır.

### Hız

Hızlar **binanın gerçek ölçeğinde** tanımlıdır (`config.js`): yürüme 1.4 m/s, dönüş 60°/s.

```
dünya_hızı = 1.4 · viewScale / 70
```

İnsan gözü modunda bu 1.4 m/s eder, maket modunda 0.02 m/s. Yani maketin içinde her iki modda da aynı insan temposuyla ilerlersin. Debug paneli iki değeri de gösterir.

### Neden "sahneyi büyütmek" ile "kullanıcıyı küçültmek" denk?

Görsel olarak `S(70)·sahne` ile `S(1/70)·kullanıcı` aynı görüntüyü verir. Ancak ikinci yöntemde rig'i 1/70 ölçeklemek, göz arası mesafeyi (IPD), el eklem boyutlarını, near/far düzlemlerini ve debug değerlerini de küçültür. Bu da stereo derinlik hatası ve hassasiyet sorunu demektir. Bu projede ölçek tek bir yerde (`modelRoot`) tutulur. XR pozları hiç değiştirilmez ve kullanıcı tarafında sayılar hep "gerçek metre" olarak kalır.

### Referans alanı

`requestSession('immersive-vr', { optionalFeatures: ['hand-tracking', 'local-floor'] })` ile oturum açılır. Ardından referans alanları şu sırayla denenir:

1. `local-floor`: orijin zemindedir ve göz yüksekliği doğrudan cihazdan gelir (Quest 3'te beklenen durum).
2. `local` (fallback): orijin başlangıçtaki baş konumundadır. Zemini yaklaşık bulmak için `xrSpace.position.y = 1.60` yapılır. Bu yalnızca referans uzayının yerini değiştirir, baş hareketleri yine aynen korunur.

---

## Jest motoru

`js/gestures.js` bağımlılıksız bir modüldür. Her iki takip sistemi de elleri aynı `HandFrame` biçimine çevirir:

```js
{ id: 'left' | 'right', tracked: true, points: { wrist, thumbTip, indexTip, middleTip, ringTip, pinkyTip, middleMcp } } // [x, y, z]
```

| Nokta | WebXR eklemi (Quest 3) | MediaPipe landmark |
|---|---|---|
| wrist | `wrist` | 0 |
| thumbTip | `thumb-tip` | 4 |
| indexTip | `index-finger-tip` | 8 |
| middleMcp | `middle-finger-phalanx-proximal` | 9 |
| middleTip | `middle-finger-tip` | 12 |
| ringTip | `ring-finger-tip` | 16 |
| pinkyTip | `pinky-finger-tip` | 20 |

MediaPipe tarafında metre cinsinden `worldLandmarks` kullanılır. Yoksa görüntü koordinatları en-boy oranıyla düzeltilir.

**Normalizasyon:** `oran = |başparmak ucu − parmak ucu| / |bilek − orta parmak MCP|`. Bu oran el büyüklüğünden, kameraya uzaklıktan ve birimden bağımsızdır.

**Hysteresis:** her parmağın bir basma (`press`) ve bir bırakma (`release`) eşiği vardır (`config.js`). Varsayılanlar: işaret 0.25/0.36, yüzük 0.27/0.38, serçe 0.29/0.40.

**Kurallar:**

1. Yeni bir pinch'in aktif olması için oranın `press` eşiğinin altına inmesi ve en az 60 ms orada kalması gerekir. Bu, titreşimi filtreler.
2. Aktif pinch, oran `release` eşiğini aşınca **o karede** biter ve hareket anında durur.
3. **Aynı elde birden fazla aday varsa:** skor `oran / press` olarak hesaplanır. En iyi iki skor `ambiguityMargin` (0.12) değerinden yakınsa durum belirsiz sayılır ve hareket olmaz. Aksi halde en iyi skoru alan parmak kazanır. Aktif jest korunur (latch), ancak başka bir parmak açıkça daha iyi pinch yaparsa jest ona geçer.
4. **Orta parmak engelleyici:** başparmak ile orta parmak birleştiğinde yüzük parmağı da anatomik olarak başparmağa yaklaşır. Quest el iskeletiyle yapılan ölçümde oran 0.22 çıktı, bu da yüzük eşiğinin altında. Orta parmak izlenir ama hiçbir işleve bağlı değildir. En yakın parmak orta parmaksa yanlışlıkla sola dönülmez.
5. **İki elin önceliği:** karşıt dönüşler (bir el sağa, diğeri sola) birbirini iptal eder. Dönüş, yürümeden önceliklidir: aynı anda ikisi istenirse sadece dönülür. Bu, mide bulantısını azaltır. "Yürürken dönmeye izin ver" kutusuyla birlikte de kullanılabilir.
6. El kaybolursa, eklem pozu `null` gelirse ya da MediaPipe'ta ana noktalar görüntü dışına çıkarsa o elin durumu sıfırlanır. Takip edilen el yoksa hareket durur.

## Hareket sistemi

`js/locomotion.js`, three.js import etmeyen saf bir matematik modülüdür.

- **Yürüme:** başın yerel bakış vektörü rig'in yaw değeriyle dünya uzayına döndürülür. Y bileşeni atılır ve vektör normalize edilir. Bu sayede yukarı ya da aşağı bakmak hızı ve yönü etkilemez. Tam aşağı bakarken son geçerli yön kullanılır. Hız `deltaTime` ile uygulanır (dt en fazla 0.1 s ile sınırlanır). Başlangıçta 0.12 s'lik kısa bir rampa vardır, bırakınca hareket anında durur.
- **Dönüş:** rig, **başın dünya konumu** etrafında dünya Y ekseninde döndürülür. Böylece oyun alanının ortasında durmasan bile yerinde dönersin. Dönüşe 0.25 s'lik yumuşak bir rampayla başlanır ve bırakınca hemen durulur.
- XR'de baş pozu her karede `XRFrame.getViewerPose()`'dan okunur. Masaüstünde kameranın yerel pozu kullanılır.

---

## Arayüz

- **Enter VR / Exit VR:** WebXR desteklenmiyorsa buton pasif olur ve nedenini söyler: HTTPS yok, `navigator.xr` yok ya da immersive-vr desteklenmiyor.
- **Start Camera:** önce uygulama içinde açık bir izin penceresi çıkar, ardından tarayıcının kendi izni istenir. İzin reddedilirse anlaşılır bir hata gösterilir.
- **Stop Camera:** kamera akışını tamamen kapatır.
- **Reset Position:** başlangıç noktasına döner. XR'de fiziksel baş ofsetini de hesaba katar.
- **Ölçek:** 1:70 insan gözü ya da 1:1 maket.
- **Debug paneli:** XR oturumu, referans alanı, el takibi durumu, algılanan el, aktif pinch, canlı pinch oranları (eşik ayarı için), komut kaynağı, ileri hız, rotasyon hızı, ölçek, göz yüksekliği (dünya, maket ve bina birimlerinde) ve FPS.
- **VR içi gösterge:** görüşün altında 16 × 5 cm'lik bir panel. İLERİ, SAĞA, SOLA ya da DUR yazar, el sayısını, hızı ve uyarıları gösterir. Doku yalnızca içerik değişince yeniden çizilir. El eklemleri küre olarak çizilir ve aktif pinch yapan parmak uçları yeşile döner.
- **VR uyarıları:** oturum `hand-tracking` olmadan açıldıysa, 4 saniye boyunca el gelmezse ya da kontrolcü algılanırsa VR içinde ve sayfada uyarı gösterilir.

## Performans

- Statik mimari (duvarlar, kapılar, kutular, oklar, insan figürleri, direkler) vertex color kullanılarak **tek bir mesh'te** birleştirilir, yani tek bir draw call.
- El eklemleri: 2 el × 25 eklem tek bir `InstancedMesh` ile çizilir, yani tek bir draw call.
- Gölge yok, Lambert malzeme kullanılıyor, foveation açık.
- Masaüstü ve VR'nin ikisi de `renderer.setAnimationLoop()` ile çalışır. MediaPipe tespiti bu döngünün içinde ve yalnızca yeni bir video karesi geldiğinde yapılır.
- VR oturumu başlayınca webcam ve MediaPipe döngüsü durdurulur. Oturum bitince masaüstü kamerası (konum, FOV) geri yüklenir ve kullanıcı VR'de nerede duruyor, nereye bakıyorsa oradan devam eder. Sayfa kapanırken (`pagehide`) kamera, model ve XR oturumu serbest bırakılır.

---

## GitHub Pages'te yayınlama

1. GitHub'da yeni bir depo aç (örneğin `webxr-quest3`) ve bu klasörün **içeriğini** deponun köküne koy:
   ```bash
   cd webxr-quest3
   git init && git add . && git commit -m "WebXR Quest 3 hand-tracking walkthrough"
   git branch -M main
   git remote add origin https://github.com/<kullanici>/webxr-quest3.git
   git push -u origin main
   ```
2. GitHub'da **Settings → Pages → Build and deployment** bölümüne git. Source olarak **Deploy from a branch**, branch olarak `main` ve klasör olarak `/ (root)` seç, sonra **Save**'e bas.
3. 1–2 dakika içinde site `https://<kullanici>.github.io/webxr-quest3/` adresinde yayına girer.

Tüm yollar göreli olduğu için (`./js/main.js`, `./css/style.css`, model URL'leri `document.baseURI`'ye göre çözülür) proje bir alt dizinde de çalışır. `.nojekyll` dosyası Jekyll işlemini kapatır. Bir build adımı yoktur.

**Yerelde çalıştırmak için** ES modülleri `file://` üzerinden açılmaz, basit bir statik sunucu gerekir: `python3 -m http.server 8000`, sonra `http://localhost:8000`. `localhost` güvenli bağlam sayıldığı için kamera çalışır. Quest'te yerel test için HTTPS gerekir (ya da `adb reverse tcp:8000 tcp:8000` ile `localhost` kullanılabilir).

## Quest 3'te test

1. Quest'te **Ayarlar → Hareket Takibi (Movement tracking) → El ve Vücut Takibi** altında **El takibi**'ni aç. İstersen "kontrolcülerden ellere otomatik geçiş" seçeneğini de açabilirsin.
2. Kontrolcüleri bırak (ya da kapat).
3. **Quest Browser**'da GitHub Pages adresini aç ve **Enter VR**'a bas. Tarayıcı ilk girişte el takibi izni isteyebilir, izin ver.
4. Ellerin beyaz ve mavi kürelerle görünmeli. Görüşün altındaki panel `El: 2/2` göstermeli.
5. Test listesi:
   - [ ] Başparmak + işaret → panel **İLERİ** yazmalı ve yürümelisin. Başını sağa çevirip tekrar dene: bu sefer o yöne yürümelisin.
   - [ ] Aşağı bakarak yürü: hız ve yön değişmemeli, yükseklik değişmemeli.
   - [ ] Başparmak + serçe → **SAĞA** dönmelisin. Başparmak + yüzük → **SOLA** dönmelisin.
   - [ ] Pinch'i bıraktığında hareket hemen durmalı. Ellerini görüş alanından çıkardığında da durmalı.
   - [ ] Pusuladaki 45° işaretleri ve uzaktaki renkli yön direkleriyle dönüşü kontrol et (K kırmızı, D mavi, G yeşil, B turuncu).
   - [ ] Eğil ya da çömel: göz yüksekliği maketin içinde de değişmeli. 1.70 m'lik insan figürleri yanında boy referansı olarak durur.
   - [ ] Quest menüsünden ya da Exit VR ile çık: sayfa hatasız masaüstü moduna dönmeli. Tekrar girip çıkmayı dene.
6. Quest'te konsol hatalarını görmek için Quest'i USB ile bağla ve masaüstü Chrome'da `chrome://inspect` aç.

**Not:** Avuç yukarı bakarken yapılan pinch, Quest'in sistem menüsü jestidir. Gezinti jestlerini avuç aşağı ya da yana bakarken yap.

**Eşik ayarı:** debug panelindeki "Pinch oranları" satırı her elin canlı oranlarını gösterir (`i` işaret, `o` orta, `y` yüzük, `s` serçe). Algılama çok hassas ya da çok zor geliyorsa `js/config.js` → `GESTURES.thresholds` değerlerini değiştir.

---

## Kendi modelini yüklemek (.glb / .gltf)

1. Modeli `assets/models/` klasörüne koy.
2. URL parametresiyle aç:
   - `?model=assets/models/bina.glb`: model **1:70 maket ölçüsünde** (metre) modellenmişse (varsayılan).
   - `?model=assets/models/bina.glb&units=real`: model **gerçek ölçüdeyse** (1 birim = 1 gerçek metre). Yükleyici modeli otomatik olarak 1/70'e indirip maket birimine getirir.
3. Modelin zemini y=0'da olmalı. Başlangıç noktası gerçek ölçekte (0, 10) m, yani modelin güneyindedir ve kuzeye (−Z) bakar. Gerekirse `js/scene.js` içindeki `SPAWN` değerini değiştir.

Model yüklenemezse bir uyarı gösterilir ve örnek sahneye dönülür. Programatik kullanım için `loadArchitectureModel(url, { units })` fonksiyonu `js/scene.js` içinde.

## Örnek sahne

Tüm ölçüler gerçek metredir ve `R()` ile maket birimine çevrilir:

- 16 × 12 m'lik tek katlı bir yapı, 3 m duvarlar
- 1.2 × 2.1 m giriş kapısı, iki iç kapı ve bir yan kapı (kapı kasalarıyla)
- Farklı yüksekliklerde kutular: 0.45 m, 0.75 m, 1.10 m, 1.20 m, 2.00 m ve 3.50 m, ayrıca 1 m'lik küpler
- Üç tane 1.70 m'lik insan figürü, 0.5 m bantlı 3 m'lik ölçüm direği ve 1 m'lik grid
- Yürüyüş yönünü gösteren zemin okları, başlangıç noktasında 8 yönlü pusula ve K/D/G/B yön direkleri

---

## Testler

### Otomatik birim testleri (bağımlılık yok)

```bash
npm test      # = node --test tests/*.test.js   (Node 18+)
```

33 test var. Kapsamları:

- **Jest:** normalizasyon, işaret/serçe/yüzük eşlemesi, aktivasyon gecikmesi, hysteresis, bırakınca anında durma, el kaybı, aynı elde belirsizlik, latch ve devralma, orta parmak engelleyicisi, iki elin önceliği, MediaPipe adaptörü.
- **Hareket:** frame-rate bağımsızlığı (30/72/90/120 fps), pitch'in etkisizliği, baş yönünde yürüme, sağ/sol dönüş yönü, baş etrafında dönüş, ölçekli hız, Reset ofseti, dt sınırı ve 1:70 sabitleri.

### Tarayıcı duman testi (isteğe bağlı)

`tests/e2e/smoke.mjs` dosyası Playwright ile sayfayı headless Chrome'da `/webxr-quest3/` alt dizininden açar:

- **Masaüstü:** sayfa yüklenir, WebXR yokken buton doğru durumdadır, ileri/sağ hareket ve ölçek modu çalışır, izin penceresi açılır, vazgeç düğmesi çalışır, **sahte webcam ile MediaPipe gerçekten yüklenip çalışır**, kamera durdurulur, izin reddedilince hata mesajı çıkar ve konsolda hata yoktur.
- **WebXR emülasyonu:** Meta'nın [IWER](https://github.com/meta-quest/immersive-web-emulation-runtime) emülatörü Quest 3 profiliyle ve el modunda kullanılır. Kontrol edilenler: oturum `local-floor` ve `hand-tracking` ile açılır. IWER'in hazır el pozlarıyla (`pinch`, `pinch-pinky`, `pinch-ring`, `pinch-middle`, `open`) ileri, sağ, sol, yok sayma ve dur davranışları doğrulanır. Sol el de test edilir. Baş 90° çevrilip 40° aşağı bakarken yürüme yönü kontrol edilir. Göz yüksekliğinin ölçeklenmediği kontrol edilir. Oturum iki kez açılıp kapatılır ve konsolda hata olmadığı doğrulanır.

Çalıştırmak için `playwright`, `iwer`, `three@0.170.0` ve `@mediapipe/tasks-vision@0.10.14` paketlerinin kurulu olduğu bir klasör ve `hand_landmarker.task` dosyası gerekir (`CDN_MIRROR` değişkeniyle verilir; ayrıntılar dosyanın başında):

```bash
CDN_MIRROR=/yol/cdnmirror CHROME_PATH=/usr/bin/google-chrome node tests/e2e/smoke.mjs "$(pwd)"
```

### Neler test edildi, neler edilmedi

| Konu | Durum |
|---|---|
| Jest ve hareket matematiği | ✅ 33/33 birim testi geçti |
| Masaüstü sayfa, arayüz, sahne ve konsol hataları | ✅ headless Chrome'da (SwiftShader) 26/26 duman kontrolü geçti |
| MediaPipe'ın yüklenip webcam akışında çalışması | ✅ Chrome'un **sahte kamerasıyla** test edildi. Sahte görüntüde el olmadığı için 0 el algılandı |
| FPS / performans | Ölçülmedi. Headless testte GPU yoktu (yazılımsal render), bu yüzden oradaki FPS ve MediaPipe süreleri (~135 ms) anlamlı değil. Gerçek bir GPU'da MediaPipe'ın kare başına birkaç ms sürmesi beklenir |
| **Gerçek bir webcam önünde gerçek elle pinch algılama** | ❌ Test edilmedi. Eşikler MediaPipe world landmark ölçüleri varsayılarak seçildi. Gerekirse debug panelindeki oranlara bakarak ayarla |
| WebXR oturumu, hand-tracking joint okuma, jestler, oturum kapatma | ✅ Yalnızca **IWER emülatörüyle** (Quest 3 profili, Meta'nın kaydedilmiş el iskeletleri) |
| **Gerçek Meta Quest 3 + Quest Browser** | ❌ **Test edilmedi.** Performans (72/90 Hz), gerçek el takibi gürültüsü, sistem jestleriyle etkileşim ve izin akışları cihazda doğrulanmalı |
| CDN adresleri | Test ortamında CDN'e ağ erişimi yoktu. Aynı sürüm paketler npm'den indirildi ve tam olarak aynı dosya yollarıyla sunuldu. GitHub Pages'te jsDelivr'den yüklenecek |
