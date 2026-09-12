import { Segmented } from "@/components/ui/segmented";

export function AuthModeSelector({
  value,
  modes,
  onChange,
  label,
}: {
  value: string;
  modes: string[];
  onChange: (value: string) => void;
  label: (mode: string) => string;
}) {
  return (
    <Segmented
      size="sm"
      value={value}
      onChange={onChange}
      options={modes.map((mode) => ({
        value: mode,
        label: label(mode),
      }))}
      className="w-full"
    />
  );
}
