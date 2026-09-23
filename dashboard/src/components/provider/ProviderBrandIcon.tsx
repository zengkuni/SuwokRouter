import { useEffect, useState, type ComponentType, type CSSProperties } from "react";
import { getProviderIconSrc } from "@/lib/provider-icon";

export function ProviderBrandIcon({
  id,
  iconUrl,
  color,
  size = 24,
  fallbackIcon: Icon,
}: {
  id: string;
  iconUrl?: string | null;
  color?: string;
  size?: number;
  fallbackIcon: ComponentType<{ className?: string; style?: CSSProperties }>;
}) {
  const custom = iconUrl?.trim();
  const [customFailed, setCustomFailed] = useState(false);

  useEffect(() => {
    if (!custom) {
      setCustomFailed(false);
      return;
    }
    const img = new Image();
    img.onload = () => setCustomFailed(false);
    img.onerror = () => setCustomFailed(true);
    img.src = custom;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [custom]);

  const src = !customFailed && custom ? custom : getProviderIconSrc(id);
  if (src) {
    const radius = Math.max(4, Math.round(size / 5));
    return (
      <span
        aria-hidden="true"
        className="block shrink-0"
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: color || "currentColor",
          WebkitMaskImage: `url(${src})`,
          maskImage: `url(${src})`,
          WebkitMaskPosition: "center",
          maskPosition: "center",
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskSize: "contain",
          maskSize: "contain",
        }}
      />
    );
  }
  return (
    <Icon
      className="shrink-0"
      style={{ width: size * 0.85, height: size * 0.85, color: color || undefined }}
    />
  );
}
