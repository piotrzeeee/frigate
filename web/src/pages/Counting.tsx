import ActivityIndicator from "@/components/indicators/activity-indicator";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useTheme } from "@/context/theme-provider";
import { resolveCameraName } from "@/hooks/use-camera-friendly-name";
import { FrigateConfig } from "@/types/frigateConfig";
import { RECORDING_REVIEW_LINK_PARAM } from "@/utils/recordingReviewUrl";
import { useEffect, useMemo, useState } from "react";
import Chart from "react-apexcharts";
import { useTranslation } from "react-i18next";
import { LuCalendar, LuChevronRight } from "react-icons/lu";
import { MdCircle } from "react-icons/md";
import { Link } from "react-router-dom";
import useSWR from "swr";

const COUNTING_COLORS = ["#5C7CFA", "#ED5CFA"];
const HOUR_CATEGORIES = Array.from({ length: 24 }, (_, hour) =>
  hour.toString().padStart(2, "0"),
);
const EMPTY_HOURS = Array(24).fill(0);

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

// open the recording a few seconds before the crossing so the
// approach is visible
const RECORDING_PREROLL_SECONDS = 5;
const RECENT_CROSSINGS_LIMIT = 10;

export default function Counting() {
  const { t } = useTranslation(["views/counting", "objects"]);
  const { data: config } = useSWR<FrigateConfig>("config");
  const { theme, systemTheme } = useTheme();

  const [day, setDay] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  useEffect(() => {
    document.title = t("documentTitle");
  }, [t]);

  const after = day.getTime() / 1000;
  const before = after + 86400;

  const {
    data: summary,
    isLoading: summaryLoading,
    error: summaryError,
  } = useSWR<SummaryRow[]>(
    ["counting/summary", { after, before, bucket: "hour" }],
    { refreshInterval: 30000 },
  );

  const { data: crossings } = useSWR<Crossing[]>(
    ["counting/crossings", { after, before, limit: 500 }],
    { refreshInterval: 30000 },
  );

  const crossingsByLine = useMemo(() => {
    const map = new Map<string, Crossing[]>();
    (crossings ?? []).forEach((crossing) => {
      const key = `${crossing.camera}|${crossing.line}`;
      const list = map.get(key) ?? [];
      if (list.length < RECENT_CROSSINGS_LIMIT) {
        list.push(crossing);
      }
      map.set(key, list);
    });
    return map;
  }, [crossings]);

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

  const hourlyByLine = useMemo(() => {
    const map = new Map<string, { in: number[]; out: number[] }>();
    lines.forEach(({ camera, line }) => {
      map.set(`${camera}|${line}`, {
        in: Array(24).fill(0),
        out: Array(24).fill(0),
      });
    });
    (summary ?? []).forEach((row) => {
      const stat = map.get(`${row.camera}|${row.line}`);
      if (!stat) {
        return;
      }
      const hour = Number(row.bucket.slice(11, 13));
      if (hour >= 0 && hour < 24) {
        stat.in[hour] += row.count_in;
        stat.out[hour] += row.count_out;
      }
    });
    return map;
  }, [lines, summary]);

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
          categories: HOUR_CATEGORIES,
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
    [theme, systemTheme],
  );

  return (
    <div className="flex size-full flex-col p-2">
      <div className="relative mb-2 flex h-11 w-full items-center justify-between">
        <div className="text-lg font-medium">{t("title")}</div>
        <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
          <PopoverTrigger asChild>
            <Button
              className="flex items-center gap-2"
              aria-label={t("selectDay")}
              variant={datePickerOpen ? "select" : "default"}
              size="sm"
            >
              <LuCalendar />
              {day.toLocaleDateString()}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto">
            <Calendar
              mode="single"
              selected={day}
              onSelect={(selected) => {
                if (!selected) {
                  return;
                }

                const next = new Date(selected);
                next.setHours(0, 0, 0, 0);
                setDay(next);
                setDatePickerOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
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
        ) : lines.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-center text-muted-foreground">
            {t("noLines")}
          </div>
        ) : (
          lines.map(({ camera, line, friendlyName }) => {
            const stat = hourlyByLine.get(`${camera}|${line}`);
            const hoursIn = stat?.in ?? EMPTY_HOURS;
            const hoursOut = stat?.out ?? EMPTY_HOURS;
            const totalIn = hoursIn.reduce((sum, val) => sum + val, 0);
            const totalOut = hoursOut.reduce((sum, val) => sum + val, 0);

            return (
              <div
                key={`${camera}|${line}`}
                className="flex flex-col gap-3 rounded-lg bg-background_alt p-4 md:rounded-2xl"
              >
                <div>
                  <div className="text-lg font-medium">{friendlyName}</div>
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
                  <StatBlock label={t("balance")} value={totalIn - totalOut} />
                </div>

                <div>
                  <div className="mb-1 text-xs text-secondary-foreground">
                    {t("hourlyChart")}
                  </div>
                  <Chart
                    type="bar"
                    height="160"
                    options={chartOptions}
                    series={[
                      { name: t("in"), data: hoursIn },
                      { name: t("out"), data: hoursOut },
                    ]}
                  />
                </div>

                <div>
                  <div className="mb-1 text-xs text-secondary-foreground">
                    {t("recentCrossings")}
                  </div>
                  {(crossingsByLine.get(`${camera}|${line}`) ?? []).length ==
                  0 ? (
                    <div className="text-sm text-muted-foreground">
                      {t("noCrossings")}
                    </div>
                  ) : (
                    <div className="flex flex-col">
                      {(crossingsByLine.get(`${camera}|${line}`) ?? []).map(
                        (crossing) => (
                          <Link
                            key={crossing.id}
                            to={`/review?${RECORDING_REVIEW_LINK_PARAM}=${camera}_${Math.floor(crossing.timestamp - RECORDING_PREROLL_SECONDS)}`}
                            aria-label={t("openRecording")}
                            className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-secondary"
                          >
                            <MdCircle
                              className="size-2 shrink-0"
                              style={{
                                color:
                                  crossing.direction == "in"
                                    ? COUNTING_COLORS[0]
                                    : COUNTING_COLORS[1],
                              }}
                            />
                            <span className="w-20 text-sm text-primary">
                              {new Date(
                                crossing.timestamp * 1000,
                              ).toLocaleTimeString()}
                            </span>
                            <span className="w-16 text-sm text-primary">
                              {crossing.direction == "in"
                                ? t("directionIn")
                                : t("directionOut")}
                            </span>
                            <span className="flex-1 text-sm text-muted-foreground">
                              {t(crossing.label, { ns: "objects" })}
                            </span>
                            <LuChevronRight className="size-4 shrink-0 text-muted-foreground" />
                          </Link>
                        ),
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
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
