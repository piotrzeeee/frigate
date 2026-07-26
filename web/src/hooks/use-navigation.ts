import { ENV } from "@/env";
import { FrigateConfig } from "@/types/frigateConfig";
import { NavData } from "@/types/navigation";
import { useMemo } from "react";
import { isDesktop } from "react-device-detect";
import { FaCompactDisc, FaVideo } from "react-icons/fa";
import { IoSearch } from "react-icons/io5";
import {
  LuArrowLeftRight,
  LuCar,
  LuConstruction,
  LuShield,
} from "react-icons/lu";
import { MdCategory, MdChat, MdVideoLibrary } from "react-icons/md";
import { TbFaceId } from "react-icons/tb";
import useSWR from "swr";
import { useIsAdmin } from "./use-is-admin";

export const ID_LIVE = 1;
export const ID_REVIEW = 2;
export const ID_EXPLORE = 3;
export const ID_EXPORT = 4;
export const ID_PLAYGROUND = 5;
export const ID_FACE_LIBRARY = 6;
export const ID_CLASSIFICATION = 7;
export const ID_CHAT = 8;
export const ID_PLATE_LIBRARY = 9;
export const ID_ALARM = 10;
export const ID_COUNTING = 11;

export default function useNavigation(
  variant: "primary" | "secondary" = "primary",
) {
  const { data: config } = useSWR<FrigateConfig>("config", {
    revalidateOnFocus: false,
  });
  const isAdmin = useIsAdmin();

  const hasChatAgent = useMemo(
    () =>
      Object.values(config?.genai ?? {}).some((agent) =>
        agent?.roles?.includes("chat"),
      ),
    [config?.genai],
  );

  const hasCountingLines = useMemo(
    () =>
      Object.values(config?.cameras ?? {}).some(
        (camera) => Object.keys(camera.counting_lines ?? {}).length > 0,
      ),
    [config?.cameras],
  );

  return useMemo(
    () =>
      [
        {
          id: ID_LIVE,
          variant,
          icon: FaVideo,
          title: "menu.live.title",
          url: "/",
        },
        {
          id: ID_REVIEW,
          variant,
          icon: MdVideoLibrary,
          title: "menu.review",
          url: "/review",
        },
        {
          id: ID_EXPLORE,
          variant,
          icon: IoSearch,
          title: "menu.explore",
          url: "/explore",
        },
        {
          id: ID_EXPORT,
          variant,
          icon: FaCompactDisc,
          title: "menu.export",
          url: "/export",
        },
        {
          id: ID_PLAYGROUND,
          variant,
          icon: LuConstruction,
          title: "menu.uiPlayground",
          url: "/playground",
          enabled: ENV !== "production",
        },
        {
          id: ID_FACE_LIBRARY,
          variant,
          icon: TbFaceId,
          title: "menu.faceLibrary",
          url: "/faces",
          enabled: isDesktop && config?.face_recognition.enabled && isAdmin,
        },
        {
          id: ID_PLATE_LIBRARY,
          variant,
          icon: LuCar,
          title: "menu.plateLibrary",
          url: "/plates",
          enabled: isDesktop && config?.lpr?.enabled && isAdmin,
        },
        {
          id: ID_ALARM,
          variant,
          icon: LuShield,
          title: "menu.alarm",
          url: "/alarm",
          enabled: isDesktop && isAdmin,
        },
        {
          id: ID_COUNTING,
          variant,
          icon: LuArrowLeftRight,
          title: "menu.counting",
          url: "/counting",
          enabled: isDesktop && isAdmin && hasCountingLines,
        },
        {
          id: ID_CLASSIFICATION,
          variant,
          icon: MdCategory,
          title: "menu.classification",
          url: "/classification",
          enabled: isDesktop && isAdmin,
        },
        {
          id: ID_CHAT,
          variant,
          icon: MdChat,
          title: "menu.chat",
          url: "/chat",
          enabled: isDesktop && isAdmin && hasChatAgent,
        },
      ] as NavData[],
    [
      config?.face_recognition?.enabled,
      config?.lpr?.enabled,
      hasChatAgent,
      hasCountingLines,
      variant,
      isAdmin,
    ],
  );
}
