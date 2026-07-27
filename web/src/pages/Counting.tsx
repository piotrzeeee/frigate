import { useApiHost } from "@/api";
import ActivityIndicator from "@/components/indicators/activity-indicator";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useTheme } from "@/context/theme-provider";
import { resolveCameraName } from "@/hooks/use-camera-friendly-name";
import { FrigateConfig } from "@/types/frigateConfig";
import { getIconForLabel } from "@/utils/iconUtil";
import { RECORDING_REVIEW_LINK_PARAM } from "@/utils/recordingReviewUrl";
import { useEffect, useMemo, useState } from "react";
import Chart from "react-apexcharts";
import { useTranslation } from "react-i18next";
import { LuCalendar, LuChevronRight } from "react-icons/lu";
import { MdCircle } from "react-icons/md";
import { Link } from "react-router-dom";
import useSWR from "swr";

const COUNTING_COLORS = ["#5C7CFA", "#ED5CFA"];

// open the recording a few seconds before the crossing so the
// approach is visible
const RECORDING_PREROLL_SECONDS = 5;
const CROSSINGS_PAGE_SIZE = 50;

type RangePreset = "today" | "week" | "month";

type SummaryRow = {
  camera: string;
  line: string;
  bucket: string;
  count_in: number;
  count_out: number;
};

type Crossing = {
  id: number;
  camera: string;
  line: string;
  label: string;
  direction: "in" | "out";
  timestamp: number;
  event_id: string | null;
};

type LineEntry = {
  camera: string;
  line: string;
  friendlyName: string;
};

const pad = (value: number) => value.toString().padStart(2, "0");

// matches the strftime buckets the summary endpoint builds in local time
const dayKey = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export default function Counting() {
  const { t } = useTranslation(["views/counting", "objects"]);
  const { data: config } = useSWR<FrigateConfig>("config");
  const { theme, systemTheme } = useTheme();
  const apiHost = useApiHost();

  const [preset, setPreset] = useState<RangePreset>("today");
  const [customDay, setCustomDay] = useState<Date | undefined>();
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [limit, setLimit] = useState(CROSSINGS_PAGE_SIZE);

  useEffect(() => {
    document.title = t("documentTitle");
  }, [t]);

  const range = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    if (customDay) {
      const day = new Date(customDay);
      day.setHours(0, 0, 0, 0);
      return { start: day, days: 1 };
    }

    const days = preset == "week" ? 7 : preset == "month" ? 30 : 1;
    start.setDate(start.getDate() - (days - 1));
    return { start, days };
  }, [preset, customDay]);

  // reset paging whenever the range changes
  useEffect(() => setLimit(CROSSINGS_PAGE_SIZE), [range]);

  const { after, before, bucket } = useMemo(() => {
    const end = new Date(range.start);
    end.setDate(end.getDate() + range.days);
    return {
      after: range.start.getTime() / 1000,
      before: end.getTime() / 1000,
      bucket: range.days == 1 ? "hour" : "day",
    };
  }, [range]);

  // one entry per chart column, keyed the way the summary endpoint buckets
  const bucketKeys = useMemo(() => {
    if (range.days == 1) {
      const day = dayKey(range.start);
      return Array.from({ length: 24 }, (_, hour) => `${day}T${pad(hour)}:00`);
    }

    return Array.from({ length: range.days }, (_, offset) => {
      const day = new Date(range.start);
      day.setDate(day.getDate() + offset);
      return dayKey(day);
    });
  }, [range]);

  const chartCategories = useMemo(
    () =>
      range.days == 1
        ? bucketKeys.map((key) => key.slice(11, 13))
        : bucketKeys.map((key) => `${key.slice(8, 10)}.${key.slice(5, 7)}`),
    [bucketKeys, range],
  );

  const {
    data: summary,
    isLoading: summaryLoading,
    error: summaryError,
  } = useSWR<SummaryRow[]>(["counting/summary", { after, before, bucket }], {
    refreshInterval: 30000,
  });

  const { data: crossings, isLoading: crossingsLoading } = useSWR<Crossing[]>(
    ["counting/crossings", { after, before, limit }],
    { refreshInterval: 30000 },
  );

  const lines = useMemo<LineEntry[]>(
    () =>
      Object.entries(config?.cameras ?? {}).flatMap(([camera, cam]) =>
        Object.entries(cam.counting_lines ?? {}).map(([line, lineConfig]) => ({
          camera,
          line,
          friendlyName: lineConfig.friendly_name || line.replaceAll("_", " "),
        })),
      ),
    [config],
  );

  const countsByLine = useMemo(() => {
    const bucketIndex = new Map(bucketKeys.map((key, index) => [key, index]));
    const map = new Map<string, { in: number[]; out: number[] }>();

    lines.forEach(({ camera, line }) =>
      map.set(`${camera}|${line}`, {
        in: Array(bucketKeys.length).fill(0),
        out: Array(bucketKeys.length).fill(0),
      }),
    );

    (summary ?? []).forEach((row) => {
      const counts = map.get(`${row.camera}|${row.line}`);
      const index = bucketIndex.get(row.bucket);

      if (counts && index != undefined) {
        counts.in[index] += row.count_in;
        counts.out[index] += row.count_out;
      }
    });

    return map;
  }, [lines, summary, bucketKeys]);

  const lineNames = useMemo(
    () =>
      new Map(
        lines.map(({ camera, line, friendlyName }) => [
          `${camera}|${line}`,
          friendlyName,
        ]),
      ),
    [lines],
  );

  const totalCrossings = useMemo(
    () =>
      (summary ?? []).reduce(
        (sum, row) => sum + row.count_in + row.count_out,
        0,
      ),
    [summary],
  );

  const chartOptions = useMemo(
    () =>
      ({
        chart: {
          toolbar: { show: false },
          zoom: { enabled: false },
        },
        colors: COUNTING_COLORS,
        grid: { show: false },
        legend: { show: false },
        dataLabels: { enabled: false },
        tooltip: { theme: systemTheme || theme },
        xaxis: {
          categories: chartCategories,
          axisBorder: { show: false },
          axisTicks: { show: false },
          labels: { style: { colors: "#6B6B6B" } },
        },
        yaxis: {
          min: 0,
          labels: {
            formatter: (val: number) => Math.ceil(val).toString(),
            style: { colors: "#6B6B6B" },
          },
        },
      }) as ApexCharts.ApexOptions,
    [theme, systemTheme, chartCategories],
  );

  return (
    <div className="flex size-full flex-col p-2">
      <div className="relative mb-2 flex h-11 w-full items-center justify-between gap-2">
        <div className="text-lg font-medium">{t("title")}</div>
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            size="sm"
            value={customDay ? "" : preset}
            onValueChange={(value: RangePreset) => {
              if (value) {
                setCustomDay(undefined);
                setPreset(value);
              }
            }}
          >
            {(["today", "week", "month"] as const).map((value) => (
              <ToggleGroupItem
                key={value}
                value={value}
                aria-label={t(`range.${value}`)}
                className={
                  !customDay && preset == value ? "" : "text-muted-foreground"
                }
              >
                {t(`range.${value}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
            <PopoverTrigger asChild>
              <Button
                className="flex items-center gap-2"
                aria-label={t("selectDay")}
                variant={customDay ? "select" : "default"}
                size="sm"
              >
                <LuCalendar />
                <div className="hidden md:block">
                  {customDay ? customDay.toLocaleDateString() : t("range.day")}
                </div>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto">
              <Calendar
                mode="single"
                selected={customDay}
                onSelect={(selected) => {
                  if (!selected) {
                    return;
                  }

                  const next = new Date(selected);
                  next.setHours(0, 0, 0, 0);
                  setCustomDay(next);
                  setDatePickerOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="scrollbar-container flex flex-1 flex-col gap-4 overflow-y-auto">
        {summaryLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <ActivityIndicator />
          </div>
        ) : summaryError ? (
          <div className="flex flex-1 items-center justify-center text-center text-danger">
            {t("loadError")}
          </div>
        ) : lines.length == 0 ? (
          <div className="flex flex-1 items-center justify-center text-center text-muted-foreground">
            {t("noLines")}
          </div>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              {lines.map(({ camera, line, friendlyName }) => {
                const counts = countsByLine.get(`${camera}|${line}`);
                const countsIn = counts?.in ?? [];
                const countsOut = counts?.out ?? [];
                const totalIn = countsIn.reduce((sum, val) => sum + val, 0);
                const totalOut = countsOut.reduce((sum, val) => sum + val, 0);

                return (
                  <div
                    key={`${camera}|${line}`}
                    className="flex flex-col gap-3 rounded-lg bg-background_alt p-4 md:rounded-2xl"
                  >
                    <div>
                      <div className="text-lg font-medium smart-capitalize">
                        {friendlyName}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {resolveCameraName(config, camera)}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-6">
                      <StatBlock
                        label={t("in")}
                        value={totalIn}
                        color={COUNTING_COLORS[0]}
                      />
                      <StatBlock
                        label={t("out")}
                        value={totalOut}
                        color={COUNTING_COLORS[1]}
                      />
                      <StatBlock
                        label={t("balance")}
                        value={totalIn - totalOut}
                      />
                    </div>

                    <div>
                      <div className="mb-1 text-xs text-secondary-foreground">
                        {range.days == 1 ? t("hourlyChart") : t("dailyChart")}
                      </div>
                      <Chart
                        type="bar"
                        height="160"
                        options={chartOptions}
                        series={[
                          { name: t("in"), data: countsIn },
                          { name: t("out"), data: countsOut },
                        ]}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col gap-2 rounded-lg bg-background_alt p-4 md:rounded-2xl">
              <div className="flex items-center justify-between">
                <div className="text-lg font-medium">{t("log")}</div>
                <div className="text-sm text-muted-foreground">
                  {t("logCount", { count: totalCrossings })}
                </div>
              </div>

              {crossingsLoading && !crossings ? (
                <div className="flex items-center justify-center py-6">
                  <ActivityIndicator />
                </div>
              ) : (crossings ?? []).length == 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  {t("noCrossings")}
                </div>
              ) : (
                <div className="flex flex-col">
                  {(crossings ?? []).map((crossing, index, all) => {
                    const day = new Date(
                      crossing.timestamp * 1000,
                    ).toLocaleDateString();
                    const previousDay =
                      index == 0
                        ? undefined
                        : new Date(
                            all[index - 1].timestamp * 1000,
                          ).toLocaleDateString();

                    return (
                      <div key={crossing.id}>
                        {day != previousDay && (
                          <div className="mb-1 mt-3 text-xs font-medium text-secondary-foreground first:mt-0">
                            {day}
                          </div>
                        )}
                        <CrossingRow
                          apiHost={apiHost}
                          crossing={crossing}
                          lineName={
                            lineNames.get(
                              `${crossing.camera}|${crossing.line}`,
                            ) ?? crossing.line
                          }
                          cameraName={resolveCameraName(
                            config,
                            crossing.camera,
                          )}
                        />
                      </div>
                    );
                  })}
                </div>
              )}

              {(crossings ?? []).length >= limit && (
                <Button
                  className="mt-2 self-center"
                  size="sm"
                  aria-label={t("loadMore")}
                  onClick={() =>
                    setLimit((value) => value + CROSSINGS_PAGE_SIZE)
                  }
                >
                  {t("loadMore")}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

type CrossingRowProps = {
  apiHost: string;
  crossing: Crossing;
  lineName: string;
  cameraName: string;
};
function CrossingRow({
  apiHost,
  crossing,
  lineName,
  cameraName,
}: CrossingRowProps) {
  const { t } = useTranslation(["views/counting", "objects"]);
  const [hovered, setHovered] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const isIn = crossing.direction == "in";
  const color = isIn ? COUNTING_COLORS[0] : COUNTING_COLORS[1];

  return (
    <Link
      to={`/review?${RECORDING_REVIEW_LINK_PARAM}=${crossing.camera}_${Math.floor(crossing.timestamp - RECORDING_PREROLL_SECONDS)}`}
      aria-label={t("openRecording")}
      className="flex items-center gap-3 rounded-md p-1.5 hover:bg-secondary"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className="flex aspect-video w-24 shrink-0 items-center justify-center overflow-hidden rounded bg-secondary"
        style={{ outline: `2px solid ${color}` }}
      >
        {crossing.event_id && !imageFailed ? (
          <img
            className="size-full object-cover"
            loading="lazy"
            draggable={false}
            src={`${apiHost}api/events/${crossing.event_id}/${hovered ? "preview.gif" : "thumbnail.webp"}`}
            onError={() => setImageFailed(true)}
            alt={t("openRecording")}
          />
        ) : (
          getIconForLabel(
            crossing.label,
            "object",
            "size-5 text-muted-foreground",
          )
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <MdCircle className="size-2 shrink-0" style={{ color }} />
          <span className="text-sm font-medium text-primary">
            {isIn ? t("directionIn") : t("directionOut")}
          </span>
          <span className="text-sm text-muted-foreground">
            {new Date(crossing.timestamp * 1000).toLocaleTimeString()}
          </span>
        </div>
        <div className="truncate text-xs text-muted-foreground smart-capitalize">
          {t(crossing.label, { ns: "objects" })} · {lineName} · {cameraName}
        </div>
      </div>

      <LuChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

type StatBlockProps = {
  label: string;
  value: number;
  color?: string;
};
function StatBlock({ label, value, color }: StatBlockProps) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 text-xs text-secondary-foreground">
        {color && <MdCircle className="size-2" style={{ color }} />}
        {label}
      </div>
      <div className="text-lg font-medium text-primary">{value}</div>
    </div>
  );
}
