"use client";
import { Select } from "@base-ui/react/select";
import { Switch } from "@base-ui/react/switch";
import { Check, ChevronDown } from "lucide-react";
import type { MdxAttribute, PropField } from "@fumadocs-editor/core/extensions";
import { focusRing, itemCls, itemIndicatorCls, popupCls } from "./components/styles";

const propInputCls =
  "h-7 w-full rounded-md border border-fd-border bg-fd-background px-2 text-[13px] text-fd-foreground outline-none transition-colors placeholder:text-fd-muted-foreground/60 focus-visible:border-fd-ring";

const propSelectCls = `inline-flex h-7 w-full cursor-pointer items-center justify-between gap-1 rounded-md border border-fd-border bg-fd-background px-2 text-[13px] capitalize text-fd-foreground transition-colors hover:bg-fd-accent ${focusRing}`;

const switchRootCls = `relative flex h-5 w-8 shrink-0 cursor-pointer rounded-full bg-fd-border p-0.5 transition-colors data-[checked]:bg-fd-primary ${focusRing}`;

const switchThumbCls =
  "aspect-square h-full rounded-full bg-fd-background shadow-sm transition-[translate] data-[checked]:translate-x-3";

/** A single labelled control for a component attribute. */
export function PropControl({
  field,
  value,
  onChange,
}: {
  field: PropField;
  value: string;
  onChange: (value: string) => void;
}) {
  const label = field.label ?? field.name;

  if (field.type === "enum") {
    const items = (field.options ?? []).map((option) => ({ value: option, label: option }));
    const current = value || String(field.default ?? field.options?.[0] ?? "");
    return (
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-fd-muted-foreground">{label}</span>
        <Select.Root
          items={items}
          value={current}
          onValueChange={(next) => onChange(next as string)}
        >
          <Select.Trigger className={propSelectCls}>
            <Select.Value />
            <ChevronDown size={13} className="shrink-0 text-fd-muted-foreground" />
          </Select.Trigger>
          <Select.Portal>
            <Select.Positioner sideOffset={4} alignItemWithTrigger={false}>
              <Select.Popup className={popupCls}>
                {items.map((item) => (
                  <Select.Item key={item.value} value={item.value} className={itemCls}>
                    <Select.ItemIndicator className={itemIndicatorCls}>
                      <Check size={14} />
                    </Select.ItemIndicator>
                    <Select.ItemText>{item.label}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Popup>
            </Select.Positioner>
          </Select.Portal>
        </Select.Root>
      </label>
    );
  }

  if (field.type === "boolean") {
    const checked = value === "" ? Boolean(field.default) : value === "true";
    return (
      <label className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-fd-muted-foreground">{label}</span>
        <Switch.Root
          className={switchRootCls}
          checked={checked}
          onCheckedChange={(next) => onChange(next ? "true" : "false")}
        >
          <Switch.Thumb className={switchThumbCls} />
        </Switch.Root>
      </label>
    );
  }

  if (field.type === "expression") {
    return (
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-fd-muted-foreground">{label}</span>
        <input
          className={`${propInputCls} font-mono text-[12px]`}
          value={value}
          spellCheck={false}
          placeholder={field.placeholder ?? "{…}"}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    );
  }

  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-fd-muted-foreground">{label}</span>
      <input
        className={propInputCls}
        type={field.type === "number" ? "number" : "text"}
        value={value}
        placeholder={field.placeholder ?? label}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
