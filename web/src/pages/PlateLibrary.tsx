import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Event } from "@/types/event";
import { FrigateConfig } from "@/types/frigateConfig";
import axios from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuCirclePlus, LuPencil, LuTrash2 } from "react-icons/lu";
import { toast } from "sonner";
import useSWR from "swr";

type KnownPlate = {
  plate: string;
  label: string | null;
  expires_at: string | null;
  created_at: string | null;
};

type ExpiryPreset = "never" | "1" | "4" | "24" | "168" | "custom";

export default function PlateLibrary() {
  const { t } = useTranslation(["views/plateLibrary"]);

  const { data: config } = useSWR<FrigateConfig>("config", {
    revalidateOnFocus: false,
  });

  const { data: knownPlates, mutate: refreshPlates } =
    useSWR<KnownPlate[]>("lpr/known_plates");

  const { data: recentEvents } = useSWR<Event[]>([
    "events",
    { limit: 25, recognized_license_plate: ".*" },
  ]);

  useEffect(() => {
    document.title = t("documentTitle");
  }, [t]);

  // dialog state

  const [editPlate, setEditPlate] = useState<KnownPlate | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [deletePlate, setDeletePlate] = useState<string | null>(null);

  const onDelete = useCallback(
    (plate: string) => {
      axios
        .delete(`lpr/known_plates/${encodeURIComponent(plate)}`)
        .then((resp) => {
          if (resp.status == 200) {
            toast.success(t("toast.success.deletedPlate", { plate }), {
              position: "top-center",
            });
            refreshPlates();
          }
        })
        .catch((error) => {
          const errorMessage =
            error.response?.data?.message ||
            error.response?.data?.detail ||
            "Unknown error";
          toast.error(t("toast.error.deletePlateFailed", { errorMessage }), {
            position: "top-center",
          });
        });
    },
    [refreshPlates, t],
  );

  if (!config?.lpr?.enabled) {
    return (
      <div className="flex size-full items-center justify-center text-muted-foreground">
        {t("lprDisabled")}
      </div>
    );
  }

  return (
    <div className="flex size-full flex-col p-2">
      <Toaster />

      <PlateEditDialog
        open={addOpen || editPlate != null}
        plate={editPlate}
        onClose={() => {
          setAddOpen(false);
          setEditPlate(null);
        }}
        onSaved={refreshPlates}
      />

      <AlertDialog
        open={deletePlate != null}
        onOpenChange={(open) => !open && setDeletePlate(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deletePlate.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deletePlate.desc", { plate: deletePlate })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("button.cancel", { ns: "common" })}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive"
              onClick={() => {
                if (deletePlate) {
                  onDelete(deletePlate);
                }
              }}
            >
              {t("button.delete", { ns: "common" })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="relative mb-2 flex h-11 w-full items-center justify-between">
        <div className="text-lg font-medium">{t("knownPlates.title")}</div>
        <Button
          className="flex items-center gap-2"
          aria-label={t("button.addPlate")}
          variant="default"
          onClick={() => setAddOpen(true)}
        >
          <LuCirclePlus className="size-4" />
          {t("button.addPlate")}
        </Button>
      </div>

      <div className="scrollbar-container flex flex-1 flex-col gap-6 overflow-y-auto">
        <div className="rounded-lg bg-background_alt p-2">
          {knownPlates?.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("table.plate")}</TableHead>
                  <TableHead>{t("table.label")}</TableHead>
                  <TableHead>{t("table.expiresAt")}</TableHead>
                  <TableHead>{t("table.createdAt")}</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {knownPlates.map((entry) => (
                  <TableRow key={entry.plate}>
                    <TableCell className="font-mono">{entry.plate}</TableCell>
                    <TableCell>{entry.label || "-"}</TableCell>
                    <TableCell
                      className={
                        entry.expires_at
                          ? "text-warning"
                          : "text-muted-foreground"
                      }
                    >
                      {entry.expires_at
                        ? new Date(entry.expires_at).toLocaleString()
                        : t("table.never")}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {entry.created_at
                        ? new Date(entry.created_at).toLocaleString()
                        : "-"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t("button.editPlate")}
                          onClick={() => setEditPlate(entry)}
                        >
                          <LuPencil className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t("button.deletePlate")}
                          onClick={() => setDeletePlate(entry.plate)}
                        >
                          <LuTrash2 className="size-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 p-8 text-muted-foreground">
              {t("knownPlates.empty")}
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 text-lg font-medium">
            {t("recentRecognitions.title")}
          </div>
          <div className="rounded-lg bg-background_alt p-2">
            {recentEvents?.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("table.time")}</TableHead>
                    <TableHead>{t("table.camera")}</TableHead>
                    <TableHead>{t("table.plate")}</TableHead>
                    <TableHead>{t("table.recognizedAs")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentEvents.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="text-muted-foreground">
                        {new Date(event.start_time * 1000).toLocaleString()}
                      </TableCell>
                      <TableCell className="capitalize">
                        {event.camera.replaceAll("_", " ")}
                      </TableCell>
                      <TableCell className="font-mono">
                        {event.data?.recognized_license_plate}
                      </TableCell>
                      <TableCell>
                        {event.sub_label ? (
                          <span className="text-success">
                            {event.sub_label}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            {t("recentRecognitions.unknown")}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 p-8 text-muted-foreground">
                {t("recentRecognitions.empty")}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type PlateEditDialogProps = {
  open: boolean;
  plate: KnownPlate | null;
  onClose: () => void;
  onSaved: () => void;
};

function PlateEditDialog({
  open,
  plate,
  onClose,
  onSaved,
}: PlateEditDialogProps) {
  const { t } = useTranslation(["views/plateLibrary"]);

  const [plateValue, setPlateValue] = useState("");
  const [labelValue, setLabelValue] = useState("");
  const [expiryPreset, setExpiryPreset] = useState<ExpiryPreset>("never");
  const [customExpiry, setCustomExpiry] = useState("");

  useEffect(() => {
    if (open) {
      setPlateValue(plate?.plate ?? "");
      setLabelValue(plate?.label ?? "");
      setExpiryPreset(plate?.expires_at ? "custom" : "never");
      setCustomExpiry(plate?.expires_at ? plate.expires_at.slice(0, 16) : "");
    }
  }, [open, plate]);

  const expiresAt = useMemo(() => {
    if (expiryPreset == "never") {
      return null;
    }

    if (expiryPreset == "custom") {
      return customExpiry || null;
    }

    const offsetMs = Number(expiryPreset) * 60 * 60 * 1000;
    const local = new Date(
      Date.now() + offsetMs - new Date().getTimezoneOffset() * 60 * 1000,
    );
    return local.toISOString().slice(0, 16);
  }, [expiryPreset, customExpiry]);

  const onSave = useCallback(() => {
    axios
      .post("lpr/known_plates", {
        plate: plateValue,
        label: labelValue || null,
        expires_at: expiresAt,
      })
      .then((resp) => {
        if (resp.status == 200) {
          toast.success(t("toast.success.savedPlate", { plate: plateValue }), {
            position: "top-center",
          });
          onSaved();
          onClose();
        }
      })
      .catch((error) => {
        const errorMessage =
          error.response?.data?.message ||
          error.response?.data?.detail ||
          "Unknown error";
        toast.error(t("toast.error.savePlateFailed", { errorMessage }), {
          position: "top-center",
        });
      });
  }, [plateValue, labelValue, expiresAt, onSaved, onClose, t]);

  return (
    <Dialog open={open} onOpenChange={(dialogOpen) => !dialogOpen && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {plate ? t("editPlate.title") : t("addPlate.title")}
          </DialogTitle>
          <DialogDescription>{t("addPlate.desc")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="plate">{t("addPlate.plate")}</Label>
            <Input
              id="plate"
              className="uppercase"
              value={plateValue}
              placeholder={t("addPlate.platePlaceholder")}
              disabled={plate != null}
              onChange={(e) => setPlateValue(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="label">{t("addPlate.label")}</Label>
            <Input
              id="label"
              value={labelValue}
              placeholder={t("addPlate.labelPlaceholder")}
              onChange={(e) => setLabelValue(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t("addPlate.expiry")}</Label>
            <Select
              value={expiryPreset}
              onValueChange={(value) => setExpiryPreset(value as ExpiryPreset)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="never">
                  {t("addPlate.expiryNever")}
                </SelectItem>
                <SelectItem value="1">
                  {t("addPlate.expiryHours", { count: 1 })}
                </SelectItem>
                <SelectItem value="4">
                  {t("addPlate.expiryHours", { count: 4 })}
                </SelectItem>
                <SelectItem value="24">
                  {t("addPlate.expiryHours", { count: 24 })}
                </SelectItem>
                <SelectItem value="168">
                  {t("addPlate.expiryDays", { count: 7 })}
                </SelectItem>
                <SelectItem value="custom">
                  {t("addPlate.expiryCustom")}
                </SelectItem>
              </SelectContent>
            </Select>
            {expiryPreset == "custom" && (
              <Input
                type="datetime-local"
                value={customExpiry}
                onChange={(e) => setCustomExpiry(e.target.value)}
              />
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("button.cancel", { ns: "common" })}
          </Button>
          <Button
            variant="select"
            disabled={plateValue.length < 2}
            onClick={onSave}
          >
            {t("button.save", { ns: "common" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
