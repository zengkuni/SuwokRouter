import type { ComponentType, CSSProperties } from "react";
import { getProviderIconSrc } from "@/lib/provider-icon";

export function ProviderBrandIcon({
  id,
  color,
  size = 24,
  fallbackIcon: Icon,
}: {
  id: string;
  color?: string;
  size?: number;
  fallbackIcon: ComponentType<{ className?: string; style?: CSSProperties }>;
}) {
  const src = getProviderIconSrc(id);
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
