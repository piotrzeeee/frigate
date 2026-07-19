import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Toaster } from "@/components/ui/sonner";
import axios from "axios";
import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { LuShield, LuShieldCheck } from "react-icons/lu";
import { toast } from "sonner";
import useSWR from "swr";

type AlarmTrigger = {
  review_id: string;
  camera: string;
  ts: string | null;
  data: { objects?: string[]; zones?: string[] };
};

type AlarmData = {
  armed: boolean;
  updated_at: string | null;
  triggers: AlarmTrigger[];
};

export default function Alarm() {
  const { t } = useTranslation(["views/alarm"]);

  const { data: alarm, mutate: refreshAlarm } = useSWR<AlarmData>("alarm", {
    refreshInterval: 5000,
  });

  useEffect(() => {
    document.title = t("documentTitle");
  }, [t]);

  const onToggle = useCallback(
    (armed: boolean) => {
      axios
        .post("alarm", { armed })
        .then((resp) => {
          if (resp.status == 200) {
            toast.success(armed ? t("toast.armed") : t("toast.disarmed"), {
              position: "top-center",
            });
            refreshAlarm();
          }
        })
        .catch((error) => {
          const errorMessage =
            error.response?.data?.message ||
            error.response?.data?.detail ||
            "Unknown error";
          toast.error(t("toast.error", { errorMessage }), {
            position: "top-center",
          });
        });
    },
    [refreshAlarm, t],
  );

  const armed = alarm?.armed ?? false;

  return (
    <div className="flex size-full flex-col p-2">
      <Toaster />

      <div className="relative mb-2 flex h-11 w-full items-center justify-between">
        <div className="text-lg font-medium">{t("title")}</div>
      </div>

      <div className="scrollbar-container flex flex-1 flex-col gap-6 overflow-y-auto">
        <div
          className={`flex items-center justify-between rounded-lg p-6 md:rounded-2xl ${
            armed ? "bg-destructive/30" : "bg-background_alt"
          }`}
        >
          <div className="flex items-center gap-4">
            {armed ? (
              <LuShieldCheck className="size-10 text-destructive" />
            ) : (
              <LuShield className="size-10 text-muted-foreground" />
            )}
            <div>
              <div className="text-lg font-medium">
                {armed ? t("state.armed") : t("state.disarmed")}
              </div>
              <div className="text-sm text-muted-foreground">
                {armed ? t("state.armedDesc") : t("state.disarmedDesc")}
                {alarm?.updated_at &&
                  ` · ${new Date(alarm.updated_at).toLocaleString()}`}
              </div>
            </div>
          </div>
          <Switch
            className="scale-125"
            checked={armed}
            onCheckedChange={onToggle}
          />
        </div>

        <div>
          <div className="mb-2 text-lg font-medium">{t("triggers.title")}</div>
          <div className="rounded-lg bg-background_alt p-2">
            {alarm?.triggers?.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("triggers.time")}</TableHead>
                    <TableHead>{t("triggers.camera")}</TableHead>
                    <TableHead>{t("triggers.objects")}</TableHead>
                    <TableHead>{t("triggers.zones")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alarm.triggers.map((trigger) => (
                    <TableRow key={trigger.review_id}>
                      <TableCell>
                        {trigger.ts
                          ? new Date(trigger.ts).toLocaleString()
                          : "-"}
                      </TableCell>
                      <TableCell className="capitalize">
                        {trigger.camera.replaceAll("_", " ")}
                      </TableCell>
                      <TableCell className="capitalize">
                        {(trigger.data.objects ?? []).join(", ") || "-"}
                      </TableCell>
                      <TableCell className="capitalize">
                        {(trigger.data.zones ?? []).join(", ") || "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 p-8 text-muted-foreground">
                {t("triggers.empty")}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
