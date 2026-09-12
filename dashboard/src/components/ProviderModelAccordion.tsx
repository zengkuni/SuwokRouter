import { useState, type ReactNode } from "react";
import { Bot } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { getProviderIconSrc } from "@/lib/provider-icon";
import { providerName } from "@/lib/providers";
import { cn } from "@/lib/utils";

export type ProviderModelItem = {
  id: string;
  name?: string;
};

export type ProviderModelGroup = {
  provider: string;
  items: ProviderModelItem[];
};

export function ProviderModelIcon({
  provider,
  className,
}: {
  provider: string;
  className?: string;
}) {
  const src = getProviderIconSrc(provider);
  const [failed, setFailed] = useState(false);

  if (!failed && src) {
    return (
      <img
        data-slot="provider-model-icon"
        src={src}
        alt=""
        width={20}
        height={20}
        className={cn("shrink-0 rounded-[4px] object-contain", className)}
        onError={() => setFailed(true)}
      />
    );
  }

  return <Bot aria-hidden="true" data-slot="provider-model-icon" className={cn("shrink-0 text-muted-foreground", className)} />;
}

export function ProviderModelAccordion({
  groups,
  query = "",
  empty,
  renderItem,
  className,
}: {
  groups: ProviderModelGroup[];
  query?: string;
  empty?: ReactNode;
  renderItem: (item: ProviderModelItem, provider: string) => ReactNode;
  className?: string;
}) {
  if (groups.length === 0) return empty ?? null;

  const normalizedQuery = query.trim().toLowerCase();
  const expandAll = Boolean(normalizedQuery);
  const groupKey = groups.map((group) => group.provider).join("|");
  const defaultValue = expandAll
    ? groups.map((group) => group.provider)
    : [groups[0].provider];

  return (
    <Accordion
      key={`${expandAll ? `search:${normalizedQuery}` : "browse"}:${groupKey}`}
      multiple
      defaultValue={defaultValue}
      className={cn("w-full", className)}
    >
      {groups.map((group) => (
        <AccordionItem
          key={group.provider}
          value={group.provider}
          className="border-border/70 px-1 last:border-b-0"
        >
          <AccordionTrigger
            className={cn(
              "w-fit flex-none justify-start gap-1.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground",
              "hover:text-foreground sm:py-2.5",
            )}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <ProviderModelIcon provider={group.provider} className="size-4" />
              <span className="truncate">{providerName(group.provider)}</span>
              <span className="rounded-full border border-border/70 px-1.5 py-0.5 text-[9px] font-normal normal-case tracking-normal text-muted-foreground/80">
                {group.items.length}
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="min-w-0 pb-1">
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.id}>{renderItem(item, group.provider)}</li>
              ))}
            </ul>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
