# Counting Lines and Face Recognition Rollout: Design

Date: 2026-07-21
Status: approved (design discussion in session)

## Goals

1. Person counting: virtual lines drawn on a camera view; every tracked object
   crossing a line is counted with a direction (in or out). Results are shown
   in a new dedicated tab in the Frigate UI. History is stored so Grafana can
   attach later.
2. Face recognition: no new code. Frigate already ships native face
   recognition (YuNet detector plus ArcFace/FaceNet embeddings,
   `frigate/data_processing/real_time/face.py`, Face Library UI). Deliverable
   is enabling and tuning it in the rpi5AI deployment config and a short
   section in our RPi5/Hailo setup guide. Embeddings run on CPU via ONNX;
   moving them to the Hailo NPU is a separate future task, analogous to what
   was done for LPR.

Everything is implemented natively in Frigate, following the same patterns as
zones and LPR.

## Part 1: Counting lines (new feature)

### Configuration

New per-camera config section, sibling of `zones`:

```yaml
cameras:
  front_door:
    counting_lines:
      entrance:
        coordinates: "0.40,0.10,0.45,0.95"   # two points, relative 0-1
        objects:
          - person                            # default: [person]
        reverse: false                        # swap in/out semantics
        friendly_name: Main entrance
        enabled: true
```

Pydantic model `CountingLineConfig` lives next to `ZoneConfig`
(`frigate/config/camera/`). Coordinates follow the zone convention
(comma-separated relative values); exactly 2 points are validated.

Direction semantics: the line is a vector from point A to point B. An object
crossing from the left side of that vector to the right side counts as `in`,
the opposite as `out`. `reverse: true` swaps them.

### Detection

Hook in `TrackedObject.update()` (`frigate/track/tracked_object.py`), in the
same place zone membership is computed:

- The anchor point is the bottom center of the bounding box, same as zones.
- Per object and per line, store which side of the line the anchor was on in
  the previous frame (sign of the 2D cross product).
- When the sign flips and the segment between the previous and current anchor
  positions intersects the line segment, emit one crossing with the direction
  taken from the sign transition.
- No debounce or hysteresis initially; one object can legitimately produce
  multiple crossings (walking in and back out is two events).
- Only objects whose label matches the line's `objects` list are considered.

Crossings are published from the camera process over the existing
inter-process messaging (ZMQ, same pattern other detectors use) and persisted
by a handler in the main process.

### Storage

Migration `038_create_line_crossing_table.py`, new Peewee model:

```
LineCrossing
  id          (auto)
  camera      (str, indexed)
  line        (str)            # config key of the line
  label       (str)            # object label, e.g. person
  direction   (str)            # "in" | "out"
  timestamp   (float, indexed)
  event_id    (str, nullable)  # tracked object id for cross-linking
```

Raw events only. All aggregation (hourly/daily buckets, current occupancy as
in minus out) is computed at query time by the API. Grafana can later read
the table directly or use the API.

### API

New router in `frigate/api/` (pattern: existing routers, `Tags` enum):

- `GET /counting/crossings`: raw crossings, filterable by camera, line,
  label, before/after.
- `GET /counting/summary`: aggregated counts (in, out, balance) bucketed by
  hour or day, filterable the same way.

Auth requirement follows camera-scoped endpoints. Regenerate the OpenAPI spec
with `generate_api_auth_spec.py` after adding the router.

### UI

- New page `web/src/pages/Counting.tsx` plus route and sidebar entry
  (pattern: `FaceLibrary.tsx`). Content: per camera/line cards with today's
  in/out and balance, an hourly bar chart, and a date range picker.
- Line editor in Settings next to the zone editor, reusing the existing
  polygon drawing canvas restricted to 2 points. Saving writes the config
  through the existing config API, same as zones.
- All user-facing strings go through i18n (`web/public/locales/en`), then
  `npm run i18n:extract`.

### Testing

- Unit tests for the crossing geometry (side computation, sign flip,
  segment intersection, reverse flag, multi-crossing) in `frigate/test/`.
- API tests for the summary bucketing.

## Part 2: Face recognition (config only)

- Enable `face_recognition` in the rpi5AI deployment config; start with
  defaults (`model_size: small`, `recognition_threshold: 0.9`) and tune on
  real footage.
- Add a face recognition section to the RPi5/Hailo setup guide in `docs/`.
- Faces are recognized live while a person is tracked; recognized names
  appear as sub labels on events and in the Face Library page where samples
  are reviewed and trained.

## Out of scope (add when needed)

- MQTT/Home Assistant sensors for the counters.
- Debounce/hysteresis at the line (start with the simple sign flip).
- Counter reset semantics (the date range picker covers it).
- Retroactive face scanning of existing recordings (a post processor like
  LPR's could be added later).
- Face embeddings on the Hailo NPU.
