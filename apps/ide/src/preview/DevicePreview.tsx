import React, { useEffect, useRef, useState } from "react";
import type { Project } from "@project/contracts";
import { RenderTree } from "./RenderTree";
import { Icon, type IconName } from "../components/Icon";

type DeviceId = "phone" | "tablet" | "desktop";

type NotchStyle = "island" | "punch" | "none";

interface DeviceSpec {
  id: DeviceId;
  label: string;
  icon: IconName;
  width: number;
  height: number;
  radius: number;
  borderSize: number;
  notch: NotchStyle;
  /** Dynamic-island / punch-hole width as a % of screen width (real iOS ≈ 31%). */
  notchWidthPct: number;
  /** Dynamic-island / punch-hole height as a % of screen height (real iOS island ≈ 4.3%). */
  notchHeightPct: number;
  /** Notch top offset as a % of screen height (sits under the status bar). */
  notchTopPct: number;
  /** Status bar + notch vertical band height (px at 1:1 device scale). */
  statusBarHeight: number;
  homebar: boolean;
}

const DEVICES: DeviceSpec[] = [
  {
    id: "phone",
    label: "iPhone",
    icon: "device-mobile",
    width: 390,
    height: 844,
    radius: 47,
    borderSize: 9,
    notch: "island",
    statusBarHeight: 48, // iPhone 14 Pro status bar + island band ≈ 48px at 1:1 device scale
    notchWidthPct: 31, // iPhone 14 Pro dynamic island ≈ 124px of 393px screen
    notchHeightPct: 4.3, // real island height ≈ 36px of 844px screen
    notchTopPct: 3.2, // island top ≈ 27px (raised — closer to the physical 14 Pro look, under a slimmer status band)
    homebar: true,
  },
  {
    id: "tablet",
    label: "Tablet",
    icon: "device-mobile",
    width: 834,
    height: 1112,
    radius: 32,
    borderSize: 13,
    notch: "none",
    notchWidthPct: 0,
    notchHeightPct: 0,
    notchTopPct: 0,
    statusBarHeight: 0,
    homebar: true,
  },
  {
    id: "desktop",
    label: "Desktop",
    icon: "device-desktop",
    width: 1080,
    height: 720,
    radius: 12,
    borderSize: 4,
    notch: "none",
    notchWidthPct: 0,
    notchHeightPct: 0,
    notchTopPct: 0,
    statusBarHeight: 0,
    homebar: false,
  },
];

export const FRAME_OUTER_PAD = { width: 12, height: 40 };

interface DevicePreviewProps {
  project: Project;
  selection: string | null;
  onSelect: (nodeId: string | null) => void;
  showToolbar?: boolean;
}

export const DevicePreview: React.FC<DevicePreviewProps> = ({
  project,
  selection,
  onSelect,
  showToolbar = true,
}) => {
  const [device, setDevice] = useState<DeviceId>("phone");
  const [stage, setStage] = useState<{ w: number; h: number } | null>(null);
  const [sysStats, setSysStats] = useState<{ time: string; battery: number | null }>({
    time: "",
    battery: null,
  });
  const hostRef = useRef<HTMLDivElement | null>(null);
  const spec = DEVICES.find((d) => d.id === device) ?? DEVICES[0];
  const isPhone = device === "phone";

  useEffect(() => {
    let alive = true;
    const tick = () => {
      window.electronAPI?.claroSysStats?.().then((s) => {
        if (alive) setSysStats(s);
      }).catch(() => {});
    };
    tick();
    const t = setInterval(tick, 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Keep the fit-to-frame scale accurate through any window/panel resize.
  // ResizeObserver updates continuously (vs. one-shot ref callbacks that
  // lagged behind drag-resizes); rAF-throttled so renders stay cheap.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      setStage((s) => (s && Math.abs(s.w - w) < 1 && Math.abs(s.h - h) < 1 ? s : { w, h }));
    };
    measure();
    let raf = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    });
    observer.observe(host);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  const outerW = spec.width + FRAME_OUTER_PAD.width;
  const outerH = spec.height + FRAME_OUTER_PAD.height;

  const scale = stage ? Math.min(stage.w / outerW, stage.h / outerH, 1) : 1;

  return (
    <div
      className={`preview__device${showToolbar ? "" : " preview__device--bare"}`}
      ref={hostRef}
    >
      <div
        className="preview__device__viewport"
        style={{
          position: "absolute",
          inset: 0,
        }}
      >
        <div
          className="preview__device__stage"
          style={{
            width: outerW,
            height: outerH,
            transform: `scale(${scale})`,
            position: "absolute",
            top: "50%",
            left: "50%",
            marginTop: -outerH / 2,
            marginLeft: -outerW / 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            className="preview__device__frame"
            style={{
              width: spec.width,
              height: spec.height,
              borderRadius: spec.radius,
              borderWidth: spec.borderSize,
            }}
          >
            {spec.notch === "island" && (
              <div
                className="preview__device__island"
                style={{
                  width: Math.round((spec.width * spec.notchWidthPct) / 100),
                  height: Math.round((spec.height * spec.notchHeightPct) / 100),
                  top: Math.round((spec.height * spec.notchTopPct) / 100),
                }}
              >
                <span className="preview__device__island__lens" />
              </div>
            )}
            {spec.notch === "punch" && (
              <div
                className="preview__device__punch"
                style={{
                  width: Math.round((spec.width * spec.notchWidthPct) / 100),
                  height: Math.round((spec.width * spec.notchWidthPct) / 100),
                  top: Math.round((spec.height * spec.notchTopPct) / 100),
                }}
              />
            )}
            {isPhone && (
              <div className="preview__device__statusbar">
                <span>{sysStats.time || "…"}</span>
                <span className="preview__device__statusbar__battery">
                  {sysStats.battery !== null ? `${sysStats.battery}%` : "…"}
                </span>
              </div>
            )}
            <div className="preview__device__screen">
              <RenderTree project={project} selection={selection} onSelect={onSelect} />
            </div>
            {spec.homebar && <div className="preview__device__homebar" />}
          </div>
        </div>
      </div>

      {showToolbar && (
        <div className="preview__device__toolbar">
          {DEVICES.map((d) => (
            <button
              key={d.id}
              className={`preview__device__btn ${device === d.id ? "preview__device__btn--active" : ""}`}
              onClick={() => setDevice(d.id)}
              title={d.label}
            >
              <Icon name={d.icon} size={16} />
              <span>{d.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};