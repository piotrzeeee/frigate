# Frigate na Raspberry Pi 5 + Hailo-10H (AI HAT+ 2) — setup

## ✅ WDROŻONE 2026-07-14 na rpi5AI (192.168.10.251)

Działająca konfiguracja (przetestowana — yolov8m, inference ~27 ms):

- Host: Debian 13, kernel 6.12, `hailo-h10-all` **5.1.1** z apt RPi (bez zmian — sentinel od niego zależy).
- Kontener: `~/hailo-frigate` (overlay msorenss), Frigate 0.18.0-beta1 + HailoRT **5.1.1**
  (deb+wheel cp311 z Hailo Dev Zone, w `services/frigate-h10/packages/`) — wersja w kontenerze
  MUSI się zgadzać z driverem hosta.
- Urządzenie: `/dev/hailo0` (nie `/dev/h1x-0` — ta nazwa jest z nowszych driverów).
- Model: lokalny `/models/yolov8m_h10.hef` (z `/usr/share/hailo-models/`, ten sam którego używa
  sentinel) zamiast ściągania z Model Zoo — HEF-y z DFC 5.4.0 mogą nie ruszyć na runtime 5.1.1.
- Porty przemapowane w `.env`, bo go2rtc sentinela zajmuje 1984/8555: Frigate go2rtc API → **1985**,
  WebRTC → **8556**. UI: `http://192.168.10.251:5000`, auth: `https://192.168.10.251:8971`.
- Kamera: TP-Link Tapo `tca72` (192.168.10.245) — detect na `stream2` (640×360@15), record na
  `stream1` (2560×1440@15). LPR włączone.
- **Sentinel**: zatrzymany na czas testów (`sudo systemctl start sentinel` przywraca; nadal
  enabled — po reboocie wstanie razem z Frigate i mogą się pobić o Hailo). Backup:
  `~/backup-sentinel-20260714.tgz` na Pi + kopia na Macu (`~/Desktop`).

### Natywna biblioteka tablic (2026-07-19)

Fork dodaje natywną stronę **Plate Library** w UI Frigate (`/plates`, ikona auta
w pasku bocznym): lista znanych tablic z etykietą (imię i nazwisko) i opcjonalnym
wygasaniem (dostęp czasowy, wpisy usuwają się same). Backend: tabela `knownplate`
(migracja 036), API `GET/POST /api/lpr/known_plates`, `DELETE /api/lpr/known_plates/{plate}`;
dopasowanie w LPR mixin ustawia `sub_label` eventu (baza ma pierwszeństwo przed
`known_plates` z configu). Na Pi wdrożone przez bind-mounty w `~/hailo-frigate/patches/`
(pliki backendu + `web-dist` z `npm run build`). `gatekeeper` to teraz tylko mostek
GPIO: event z tablicą + sub_label → impuls na GPIO17 (port 8090: /api/status, /api/test).
Uwaga: `docs/static/frigate-api.yaml` wymaga regeneracji (`python3 generate_api_auth_spec.py`)
w pełnym środowisku dev — w kontenerze beta1 wynik byłby niekompletny.

### Rozpoznawanie twarzy (2026-07-26)

To natywna funkcja Frigate (nie coś dodanego przez fork, zob.
`docs/docs/configuration/face_recognition.md`), zostaje tylko włączona na rpi5AI:

```yaml
face_recognition:
  enabled: true
  model_size: small # embeddingi liczą się na CPU hosta przez ONNX, nie na Hailo NPU
```

Wymaga śledzenia `person` na danej kamerze (`objects.track: [person, ...]`): Frigate
musi najpierw wykryć osobę, zanim spróbuje wykryć i rozpoznać jej twarz. Po włączeniu
(wymaga restartu Frigate) dostroić na realnym materiale z kamer: `recognition_threshold`
(domyślnie 0.9, za wysoki próg daje same "Unknown", za niski daje fałszywe dopasowania)
oraz `min_area` (minimalny rozmiar twarzy w pikselach, zależny od rozdzielczości strumienia
`detect`). Trening przez zakładkę **Face Library** w UI: kreator **Add Face** na start
(kilka wyraźnych, frontalnych zdjęć na osobę), potem douczanie z zakładki **Train** na
podstawie tego, co Frigate faktycznie widzi na kamerach, zamiast masowego importu zdjęć.
Podobnie jak wcześniejsza migracja OCR LPR na Hailo NPU (`lpr.device: Hailo`), przeniesienie
embeddingów rozpoznawania twarzy z CPU hosta na NPU to możliwe zadanie na przyszłość.

---

Reszta dokumentu: ogólny przewodnik. Stan researchu na 2026-07-14. Frigate oficjalnie NIE wspiera Hailo-10H (najwcześniej 0.19,
[dyskusja #21667](https://github.com/blakeblackshear/frigate/discussions/21667)).
Ten przewodnik używa community-overlay [msorenss/hailo-frigate-standalone](https://github.com/msorenss/hailo-frigate-standalone)
(Frigate 0.18.0-beta1 + HailoRT 5.3.0). Pełny research: `.remember/research/hailo10h-frigate.md`.

## Dlaczego to nie działa out-of-the-box

- Hailo-8/8L = HailoRT **4.x** (to jest w oficjalnym obrazie Frigate), Hailo-10H = HailoRT **5.x**.
  Te runtime'y i sterowniki się wykluczają — stąd nakładka na obraz.
- HEF-y z Hailo-8 nie działają na 10H. Prekompilowane modele 10H:
  Model Zoo `Compiled/v5.4.0/hailo10h/` (yolov6n/yolov8/yolov11).
  **Uwaga:** domyślny URL w msorenss (`v2.15.0/hailo10h/`) zwraca 403 — używaj `v5.4.0`.

## 1. Host (Raspberry Pi OS 64-bit)

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y hailo-h10-all   # HailoRT 5.x + sterownik hailo1x_pci (NIE hailo-all!)
sudo reboot
hailortcli fw-control identify      # musi pokazać "Device Architecture: HAILO10H"
ls /dev/h1x-0                       # urządzenie 10H
```

- `hailo-h10-all` i `hailo-all` (Hailo-8) nie mogą być zainstalowane równocześnie.
- Kernel ≥ ~6.18 (Trixie): sterownik 5.3.0 się nie kompiluje (`del_timer_sync`);
  fix = [hailort-drivers PR #52](https://github.com/hailo-ai/hailort-drivers/pull/52) przez DKMS,
  przepis: [community.hailo.ai/t/19511](https://community.hailo.ai/t/hailo-10h-working-on-kernel-6-18-34-rpi-5-using-pr-52-hailort-5-3-0/19511).
- Docker: `curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker $USER`

## 2. Paczki HailoRT 5.3.0 (wymagany login na hailo.ai)

Z [Hailo Developer Zone](https://hailo.ai/developer-zone/software-downloads/) pobierz:

- `hailort_5.3.0_arm64.deb`
- `hailort-5.3.0-cp311-cp311-linux_aarch64.whl` (cp311 = Python w obrazie Frigate)

## 3. Frigate (overlay msorenss)

```bash
git clone https://github.com/msorenss/hailo-frigate-standalone
cd hailo-frigate-standalone
cp .env.example .env                                  # TZ=Europe/Warsaw itd.
cp packages/* services/frigate-h10/packages/          # wgraj obie paczki z kroku 2
cp config/frigate/config.yml.example config/frigate/config.yml
docker compose build frigate-h10 && docker compose up -d frigate-h10
```

(Serwis `hailo-vlm` jest opcjonalny — VLM na tym samym chipie; na start pomiń.)

## 4. config.yml — detektor + kamery + LPR + Home Assistant

```yaml
mqtt:                        # integracja z Home Assistant (integracja "Frigate" w HACS)
  host: <ip-brokera>
  user: <user>
  password: <pass>

detectors:
  hailo:
    type: hailo10h           # plugin generowany przez overlay
    device: PCIe

model:                       # jawnie, bo domyślny URL w overlay jest zepsuty (403)
  path: https://hailo-model-zoo.s3.eu-west-2.amazonaws.com/ModelZoo/Compiled/v5.4.0/hailo10h/yolov6n.hef
  width: 640
  height: 640
  input_tensor: nhwc
  input_pixel_format: rgb
  model_type: yolo-generic

lpr:                         # rozpoznawanie tablic — wbudowane od 0.16
  enabled: true
  # format: "^[A-Z]{2,3}[A-Z0-9]{4,5}$"   # polskie tablice (opcjonalny filtr)
  # known_plates:
  #   moj_samochod: ["WA12345"]

cameras:
  brama:
    ffmpeg:
      inputs:
        - path: rtsp://user:pass@<ip-kamery>:554/stream1
          roles: [detect, record]
    detect:
      width: 1280
      height: 720
    objects:
      track: [person, car, motorcycle]   # LPR wymaga śledzenia car/motorcycle
record:
  enabled: true
  alerts:
    retain:
      days: 14
```

- LPR (YOLOv9 + PaddleOCR) liczy się na **CPU Pi**, nie na Hailo — 10H przyspiesza
  tylko główną detekcję obiektów. Przy słabym odczycie podnieś `lpr.enhancement`,
  albo dedykowana kamera na bramę z `type: lpr`.
- UI: `http://<ip-pi>:5000`, z autoryzacją: `https://<ip-pi>:8971`.

## Nasz fork

Branch `hailo10h` w [piotrzeeee/frigate](https://github.com/piotrzeeee/frigate) dodaje
natywne wykrywanie HAILO10H w `frigate/detectors/plugins/hailo8l.py` (typ configu
zostaje `hailo8l`). Pełny build obrazu z forka wymaga HailoRT 5.x, którego
`frigate-nvr/hailort` nie publikuje (tylko 4.x) — do czasu unifikacji sterowników
przez Hailo deployujemy przez overlay z punktu 3.
