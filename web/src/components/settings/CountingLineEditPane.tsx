import Heading from "../ui/heading";
import { Separator } from "../ui/separator";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useCallback, useEffect, useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, FormProvider } from "react-hook-form";
import { z } from "zod";
import PolygonEditControls from "./PolygonEditControls";
import { FaCheckCircle } from "react-icons/fa";
import { CountingLineFormValuesType, Polygon } from "@/types/canvas";
import useSWR from "swr";
import { FrigateConfig } from "@/types/frigateConfig";
import { flattenPoints, interpolatePoints } from "@/utils/canvasUtil";
import axios from "axios";
import { toast } from "sonner";
import ActivityIndicator from "../indicators/activity-indicator";
import { Link } from "react-router-dom";
import { LuExternalLink } from "react-icons/lu";
import { useTranslation } from "react-i18next";
import { useDocDomain } from "@/hooks/use-doc-domain";
import NameAndIdFields from "../input/NameAndIdFields";
import { Switch } from "../ui/switch";

type CountingLineEditPaneProps = {
  polygons?: Polygon[];
  setPolygons: React.Dispatch<React.SetStateAction<Polygon[]>>;
  activePolygonIndex?: number;
  scaledWidth?: number;
  scaledHeight?: number;
  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  onSave?: () => void;
  onCancel?: () => void;
  snapPoints: boolean;
  setSnapPoints: React.Dispatch<React.SetStateAction<boolean>>;
  editingProfile?: string | null;
};

export default function CountingLineEditPane({
  polygons,
  setPolygons,
  activePolygonIndex,
  scaledWidth,
  scaledHeight,
  isLoading,
  setIsLoading,
  onSave,
  onCancel,
  snapPoints,
  setSnapPoints,
  editingProfile,
}: CountingLineEditPaneProps) {
  const { t } = useTranslation(["views/settings"]);
  const { getLocaleDocUrl } = useDocDomain();
  const { data: config, mutate: updateConfig } =
    useSWR<FrigateConfig>("config");

  const polygon = useMemo(() => {
    if (polygons && activePolygonIndex !== undefined) {
      return polygons[activePolygonIndex];
    } else {
      return null;
    }
  }, [polygons, activePolygonIndex]);

  const cameraConfig = useMemo(() => {
    if (polygon?.camera && config) {
      return config.cameras[polygon.camera];
    }
  }, [polygon, config]);

  const defaultName = useMemo(() => {
    if (!polygons) {
      return "";
    }

    const count = polygons.filter(
      (poly) => poly.type == "counting_line",
    ).length;

    return t("masksAndZones.countingLines.defaultName", {
      number: count,
    });
  }, [polygons, t]);

  const defaultId = useMemo(() => {
    if (!polygons) {
      return "";
    }

    const count = polygons.filter(
      (poly) => poly.type == "counting_line",
    ).length;

    return `counting_line_${count}`;
  }, [polygons]);

  const formSchema = z.object({
    name: z
      .string()
      .min(1, {
        message: t("masksAndZones.form.id.error.mustNotBeEmpty"),
      })
      .refine(
        (value: string) => {
          // When editing, allow the same name
          if (polygon?.name && value === polygon.name) {
            return true;
          }
          // Check if a counting line with this ID already exists
          const existingLineIds = Object.keys(
            cameraConfig?.counting_lines || {},
          );
          return !existingLineIds.includes(value);
        },
        {
          message: t("masksAndZones.form.id.error.alreadyExists"),
        },
      ),
    friendly_name: z.string().min(1, {
      message: t("masksAndZones.form.name.error.mustNotBeEmpty"),
    }),
    enabled: z.boolean(),
    reverse: z.boolean(),
    isFinished: z.boolean().refine((val) => val === true, {
      message: t("masksAndZones.form.polygonDrawing.error.mustBeFinished"),
    }),
    // A counting line must have exactly its 2 endpoints. isFinished alone
    // isn't enough: deleting a point after the line auto-finishes leaves
    // it stuck "finished" with a single point.
    hasTwoPoints: z.boolean().refine((val) => val === true, {
      message: t("masksAndZones.countingLines.form.error.mustHaveTwoPoints"),
    }),
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    mode: "onChange",
    defaultValues: {
      name: polygon?.name || defaultId,
      friendly_name: polygon?.friendly_name || defaultName,
      enabled: polygon?.enabled ?? true,
      reverse: polygon?.reverse ?? false,
      isFinished: polygon?.isFinished ?? false,
      hasTwoPoints: polygon?.points.length === 2,
    },
  });

  useEffect(() => {
    if (polygon?.isFinished !== undefined) {
      form.setValue("isFinished", polygon.isFinished, { shouldValidate: true });
    }
    if (polygon?.points) {
      form.setValue("hasTwoPoints", polygon.points.length === 2, {
        shouldValidate: true,
      });
    }
  }, [polygon?.isFinished, polygon?.points, form]);

  const saveToConfig = useCallback(
    async ({
      name: lineId,
      friendly_name,
      enabled,
      reverse,
    }: CountingLineFormValuesType) => {
      if (!scaledWidth || !scaledHeight || !polygon || !cameraConfig) {
        return;
      }

      const coordinates = flattenPoints(
        interpolatePoints(polygon.points, scaledWidth, scaledHeight, 1, 1),
      ).join(",");

      const editingLine = polygon.name.length > 0;
      const renamingLine = editingLine && lineId !== polygon.name;

      // Build the new counting line configuration. Counted objects
      // default to "person" server-side and are edited via YAML in v1,
      // so they're intentionally left out of this partial update.
      const lineConfig = {
        friendly_name: friendly_name,
        enabled: enabled,
        reverse: reverse,
        coordinates: coordinates,
      };

      // Counting lines have no profile support, so renaming/saving
      // always targets the base config.
      if (renamingLine) {
        try {
          await axios.put(
            `config/set?cameras.${polygon.camera}.counting_lines.${polygon.name}`,
            { requires_restart: 1 },
          );
        } catch {
          toast.error(t("toast.save.error.noMessage", { ns: "common" }), {
            position: "top-center",
          });
          setIsLoading(false);
          return;
        }
      }

      // Counting lines are read once at startup: there is no valid
      // update_topic for hot-applying them, so it's intentionally omitted.
      axios
        .put("config/set", {
          config_data: {
            cameras: {
              [polygon.camera]: { counting_lines: { [lineId]: lineConfig } },
            },
          },
          requires_restart: 1,
        })
        .then((res) => {
          if (res.status === 200) {
            toast.success(
              `${t("masksAndZones.countingLines.toast.success.title", {
                polygonName: friendly_name || lineId,
              })} ${t("masksAndZones.countingLines.restartRequired")}`,
              {
                position: "top-center",
              },
            );
            updateConfig();
          } else {
            toast.error(
              t("toast.save.error.title", {
                errorMessage: res.statusText,
                ns: "common",
              }),
              {
                position: "top-center",
              },
            );
          }
        })
        .catch((error) => {
          const errorMessage =
            error.response?.data?.message ||
            error.response?.data?.detail ||
            "Unknown error";
          toast.error(
            t("toast.save.error.title", { errorMessage, ns: "common" }),
            {
              position: "top-center",
            },
          );
        })
        .finally(() => {
          setIsLoading(false);
        });
    },
    [
      updateConfig,
      polygon,
      scaledWidth,
      scaledHeight,
      setIsLoading,
      cameraConfig,
      t,
    ],
  );

  function onSubmit(values: z.infer<typeof formSchema>) {
    if (activePolygonIndex === undefined || !values || !polygons) {
      return;
    }
    setIsLoading(true);

    saveToConfig(values as CountingLineFormValuesType);
    if (onSave) {
      onSave();
    }
  }

  useEffect(() => {
    document.title = t("masksAndZones.countingLines.documentTitle");
  }, [t]);

  if (!polygon) {
    return;
  }

  return (
    <>
      <Heading as="h3" className="my-2">
        {polygon.name.length
          ? t("masksAndZones.countingLines.edit")
          : t("masksAndZones.countingLines.add")}
      </Heading>
      <div className="my-2 text-sm text-muted-foreground">
        <p>{t("masksAndZones.countingLines.desc.title")}</p>
        <div className="mt-2 flex items-center text-primary">
          <Link
            to={getLocaleDocUrl("configuration/counting_lines")}
            target="_blank"
            rel="noopener noreferrer"
            className="inline"
          >
            {t("readTheDocumentation", { ns: "common" })}
            <LuExternalLink className="ml-2 inline-flex size-3" />
          </Link>
        </div>
      </div>
      <Separator className="my-3 bg-secondary" />
      {polygons && activePolygonIndex !== undefined && (
        <div className="my-2 flex w-full flex-row justify-between text-sm">
          <div className="my-1 inline-flex">
            {t("masksAndZones.countingLines.point", {
              count: polygons[activePolygonIndex].points.length,
            })}
            {polygons[activePolygonIndex].isFinished && (
              <FaCheckCircle className="ml-2 size-5" />
            )}
          </div>
          <PolygonEditControls
            polygons={polygons}
            setPolygons={setPolygons}
            activePolygonIndex={activePolygonIndex}
            snapPoints={snapPoints}
            setSnapPoints={setSnapPoints}
          />
        </div>
      )}
      <div className="mb-3 text-sm text-muted-foreground">
        {t("masksAndZones.countingLines.clickDrawLine")}
      </div>

      <Separator className="my-3 bg-secondary" />

      <FormProvider {...form}>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-1 flex-col space-y-6"
          >
            <NameAndIdFields
              type="counting_line"
              control={form.control}
              nameField="friendly_name"
              idField="name"
              idVisible={(polygon && polygon.name.length > 0) ?? false}
              nameLabel={t("masksAndZones.countingLines.name.title")}
              nameDescription={t(
                "masksAndZones.countingLines.name.description",
              )}
              placeholderName={t(
                "masksAndZones.countingLines.name.placeholder",
              )}
              idDisabled={!!editingProfile && polygon.name.length > 0}
            />
            <FormField
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <FormLabel>
                      {t("masksAndZones.masks.enabled.title")}
                    </FormLabel>
                    <FormDescription>
                      {t("masksAndZones.masks.enabled.description")}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="reverse"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <FormLabel>
                      {t("masksAndZones.countingLines.reverse")}
                    </FormLabel>
                    <FormDescription>
                      {t("masksAndZones.countingLines.reverseDesc")}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="isFinished"
              render={() => (
                <FormItem>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="hasTwoPoints"
              render={() => (
                <FormItem>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex flex-1 flex-col justify-end">
              <div className="flex flex-row gap-2 pt-5">
                <Button
                  className="flex flex-1"
                  aria-label={t("button.cancel", { ns: "common" })}
                  onClick={onCancel}
                >
                  {t("button.cancel", { ns: "common" })}
                </Button>
                <Button
                  variant="select"
                  aria-label={t("button.save", { ns: "common" })}
                  disabled={isLoading || !form.formState.isValid}
                  className="flex flex-1"
                  type="submit"
                >
                  {isLoading ? (
                    <div className="flex flex-row items-center gap-2">
                      <ActivityIndicator className="size-4" />
                      <span>{t("button.saving", { ns: "common" })}</span>
                    </div>
                  ) : (
                    t("button.save", { ns: "common" })
                  )}
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </FormProvider>
    </>
  );
}
