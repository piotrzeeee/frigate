---
id: counting_lines
title: Counting Lines
---

import ConfigTabs from "@site/src/components/ConfigTabs";
import TabItem from "@theme/TabItem";
import NavPath from "@site/src/components/NavPath";

Counting lines let you count objects that cross a line you draw across the camera frame, for example cars passing a driveway or people entering and exiting through a doorway. Each crossing is recorded with a timestamp, camera, line, and direction, so totals can be reviewed in the Frigate UI or pulled into an external dashboard such as Grafana.

## Direction Semantics

A counting line is defined by two points. Walking along the line from the first point to the second, objects that pass from your left to your right are counted as `in`; objects passing from your right to your left are counted as `out`. Set `reverse: true` to swap which side is `in` and which is `out`.

## Creating a Counting Line

<ConfigTabs>
<TabItem value="ui">

1. Navigate to <NavPath path="Settings > Camera configuration > Masks / Zones" /> and select the desired camera.
2. Under the **Counting Lines** section, click the plus icon to add a new line.
3. Click on the camera's latest image to place the two endpoints of the line.
4. Configure options such as **Friendly name**, **Enabled**, and **Reverse direction** in the line editor.
5. Press **Save** when finished.

:::note

Counting lines are read once at startup. Saving a counting line (adding, editing, or removing one) requires restarting Frigate before the change takes effect.

:::

</TabItem>
<TabItem value="yaml">

Follow the steps above to draw the line's endpoints with the editor, or define counting lines directly in your configuration file:

```yaml
cameras:
  front_door:
    counting_lines:
      entrance:
        coordinates: "0.40,0.10,0.45,0.95"
        objects:
          - person
        reverse: false
        friendly_name: Main entrance
```

| Field           | Description                                                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------|
| `coordinates`   | Two points that define the line as relative (0-1) coordinates in the form `x1,y1,x2,y2`.                                                             |
| `objects`       | Object types (from the labelmap) counted when crossing this line. Defaults to `[person]`. An empty list counts all objects. This is only configurable via YAML, not the line editor. |
| `reverse`       | Swap the `in` and `out` directions of the line. Defaults to `false`.                                                                                 |
| `friendly_name` | A user-friendly name shown in the Frigate UI. If not set, a formatted version of the line name is used.                                              |
| `enabled`       | Enable or disable this counting line. Disabled lines are ignored at runtime. Defaults to `true`.                                                     |

As with editing through the UI, changes to `counting_lines` in the configuration file require restarting Frigate to take effect.

</TabItem>
</ConfigTabs>

## Viewing Counts

The **Counting** tab in the Frigate UI shows daily in/out totals for each camera and line, broken down by hour. This tab is available to admin users.

## Counting Line API

Recorded crossings are available through the HTTP API for use in external tools such as Grafana:

- `GET /counting/summary`: aggregated `in`/`out` counts per camera and line, bucketed by hour or day in server local time. Accepts `cameras`, `lines`, `labels`, `after`, `before`, and `bucket` (`hour` or `day`, default `hour`) query parameters. This endpoint does not use `limit`; all matching buckets are returned.
- `GET /counting/crossings`: individual crossing events, newest first. Accepts `cameras`, `lines`, `labels`, `after`, `before`, and `limit` (default `100`) query parameters. Results are capped at `limit` rows, most recent first, so raise it if you need a longer history in one request.

Both endpoints are camera-filtered: a request only returns data for cameras the authenticated user has access to. See the [HTTP API reference](/integrations/api/frigate-http-api) for the full list of parameters and response fields.
