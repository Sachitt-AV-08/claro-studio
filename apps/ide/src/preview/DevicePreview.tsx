import React, { useEffect, useRef, useState } from "react";
import type { Project } from "@project/contracts";
import { RenderTree } from "./RenderTree";
import { Icon, type IconName } from "../components/Icon";

type DeviceId = "phone" | "tablet" | "desktop";

interface DeviceSpec {
  id: DeviceId;
  label: string;
  icon: IconName;
  width: number;
  height: number;
  radius: number;
  borderSize: number;
  notch: boolean;
  homebar: boolean;
}

const DEVICES: DeviceSpec[] = [
  {
    id: "phone",
    label: "iPhone",
    icon: "device-mobile",
    width: 375,
    height: 788,
    radius: 42,
    borderSize: 11,
    notch: true,
    homebar: true,
  },
  {
    id: "tablet",
    label: "Tablet",
    icon: "device-mobile",
    width: 834,
    height: 1112,
    radius: 26,
    borderSize: 14,
    notch: false,
    homebar: true,
  },
  {
    id: "desktop",
    label: "Desktop",
    icon: "device-desktop",
    width: 1080,
    height: 720,
    radius: 10,
    borderSize: 6,
    notch: false,
    homebar: false,
  },
];

const FRAME_OUTER_PAD = {
  width: 96,
  height: 168,
};

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
  const hostRef = useRef<HTMLDivElement | null>(null);
  const spec = DEVICES.find((d) => d.id === device) ?? DEVICES[0];
  const isPhone = device === "phone";

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
            {spec.notch && <div className="preview__device__notch" />}
            {isPhone && (
              <div className="preview__device__statusbar">
                <span>9:41</span>
                <span className="preview__device__statusbar__battery">100%</span>
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