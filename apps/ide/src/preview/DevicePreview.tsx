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
    notchTopPct: 0.8, // island top ≈ 7px (at the top edge — matches 14 Pro physical)
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

type Orientation = "portrait" | "landscape";

export const DevicePreview: React.FC<DevicePreviewProps> = ({
  project,
  selection,
  onSelect,
  showToolbar = true,
}) => {
  const [device, setDevice] = useState<DeviceId>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("claro:preview:device") as DeviceId) || "phone";
    }
    return "phone";
  });
  const [orientation, setOrientation] = useState<Orientation>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("claro:preview:orientation") as Orientation) || "portrait";
    }
    return "portrait";
  });
  const [zoomLevel, setZoomLevel] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("claro:preview:zoom");
      return saved ? parseFloat(saved) : 1;
    }
    return 1;
  });
  const [safariChrome, setSafariChrome] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("claro:preview:safariChrome") === "true";
    }
    return true;
  });
  const [stage, setStage] = useState<{ w: number; h: number } | null>(null);
  const [sysStats, setSysStats] = useState<{ time: string; battery: number | null }>({
    time: "",
    battery: null,
  });
  const hostRef = useRef<HTMLDivElement | null>(null);
  const spec = DEVICES.find((d) => d.id === device) ?? DEVICES[0];
  const isPhone = device === "phone";
  const isLandscape = orientation === "landscape";
  const currentWidth = isLandscape ? spec.height : spec.width;
  const currentHeight = isLandscape ? spec.width : spec.height;

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

  useEffect(() => {
    localStorage.setItem("claro:preview:device", device);
  }, [device]);

  useEffect(() => {
    localStorage.setItem("claro:preview:orientation", orientation);
  }, [orientation]);

  useEffect(() => {
    localStorage.setItem("claro:preview:zoom", String(zoomLevel));
  }, [zoomLevel]);

  useEffect(() => {
    localStorage.setItem("claro:preview:safariChrome", String(safariChrome));
  }, [safariChrome]);

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

  const outerW = currentWidth + FRAME_OUTER_PAD.width;
  const outerH = currentHeight + FRAME_OUTER_PAD.height;

  const scale = stage ? Math.min(stage.w / outerW, stage.h / outerH, 1) * zoomLevel : 1;

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
            className={`preview__device__frame${isLandscape ? " preview__device--landscape" : ""}`}
            style={{
              width: currentWidth,
              height: currentHeight,
              borderRadius: spec.radius,
              borderWidth: spec.borderSize,
            }}
          >
            {spec.notch === "island" && (
              <div
                className="preview__device__island"
                style={{
                  width: Math.round((currentWidth * spec.notchWidthPct) / 100),
                  height: Math.round((currentHeight * spec.notchHeightPct) / 100),
                  top: Math.round((currentHeight * spec.notchTopPct) / 100),
                }}
              >
                <span className="preview__device__island__lens" />
              </div>
            )}
            {spec.notch === "punch" && (
              <div
                className="preview__device__punch"
                style={{
                  width: Math.round((currentWidth * spec.notchWidthPct) / 100),
                  height: Math.round((currentWidth * spec.notchWidthPct) / 100),
                  top: Math.round((currentHeight * spec.notchTopPct) / 100),
                }}
              />
            )}
            {safariChrome && isPhone && !isLandscape && (
              <div className="preview__device__safari-bar">
                <div className="preview__device__safari-bar__left">
                  <Icon name="chevron-left" size={14} />
                  <Icon name="chevron-right" size={14} />
                  <Icon name="send" size={14} />
                </div>
                <div className="preview__device__safari-bar__url">
                  <Icon name="eye" size={12} />
                  <span>https://claro.workbench</span>
                </div>
                <div className="preview__device__safari-bar__right">
                  <Icon name="tools" size={14} />
                  <Icon name="comment" size={14} />
                </div>
              </div>
            )}
            {isPhone && !safariChrome && (
              <div className="preview__device__statusbar">
                <span>{sysStats.time || "…"}</span>
                <span className="preview__device__statusbar__battery">
                  {sysStats.battery !== null ? `${sysStats.battery}%` : "…"}
                </span>
              </div>
            )}
            <div
              className="preview__device__screen"
              style={{
                paddingTop: isPhone && !isLandscape && safariChrome ? 44 : 0,
                paddingBottom: isPhone && safariChrome ? 44 : 0,
              }}
            >
              <div
                className="preview__device__safe-area"
                style={{
                  paddingTop: `env(safe-area-inset-top)`,
                  paddingBottom: `env(safe-area-inset-bottom)`,
                  paddingLeft: `env(safe-area-inset-left)`,
                  paddingRight: `env(safe-area-inset-right)`,
                  height: "100%",
                }}
              >
                <RenderTree project={project} selection={selection} onSelect={onSelect} />
              </div>
            </div>
            {spec.homebar && <div className="preview__device__homebar" />}
          </div>
        </div>
      </div>

      {showToolbar && (
        <div className="preview__device__toolbar">
          <div className="preview__device__toolbar__group">
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
          <div className="preview__device__toolbar__group">
            <button
              className={`preview__device__btn ${orientation === "landscape" ? "preview__device__btn--active" : ""}`}
              onClick={() => setOrientation((o) => (o === "portrait" ? "landscape" : "portrait"))}
              title="Toggle orientation"
            >
              <Icon name={orientation === "portrait" ? "chevron-down" : "chevron-up"} size={16} />
            </button>
            <button
              className="preview__device__btn"
              onClick={() => setZoomLevel((z) => Math.max(0.5, z - 0.25))}
              title="Zoom out"
            >
              <Icon name="chevron-down" size={16} />
            </button>
            <span className="preview__device__zoom-label">{Math.round(zoomLevel * 100)}%</span>
            <button
              className="preview__device__btn"
              onClick={() => setZoomLevel((z) => Math.min(2, z + 0.25))}
              title="Zoom in"
            >
              <Icon name="chevron-up" size={16} />
            </button>
            <button
              className={`preview__device__btn ${safariChrome ? "preview__device__btn--active" : ""}`}
              onClick={() => setSafariChrome((s) => !s)}
              title="Toggle Safari chrome"
            >
              <Icon name="device-desktop" size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};