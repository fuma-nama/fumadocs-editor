"use client";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "./styles/tokens.stylex";
import { consts } from "./styles/consts.stylex";
import { Select } from "@base-ui/react/select";
import { Switch } from "@base-ui/react/switch";
import { Check, ChevronDown } from "lucide-react";
import type { PropField } from "@fumadocs-editor/core/extensions";
import { chrome } from "./styles/shared";
import { useEditorPortal } from "./utils/portal";

const muted = tokens.mutedForeground;

const styles = stylex.create({
  field: { display: "flex", flexDirection: "column", gap: "0.25rem" },
  row: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" },
  label: { fontSize: 11, fontWeight: 500, color: muted },
  select: {
    display: "inline-flex",
    height: "1.75rem",
    width: "100%",
    cursor: "pointer",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.25rem",
    borderRadius: "0.375rem",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    backgroundColor: { default: tokens.background, ":hover": tokens.accent },
    paddingInline: "0.5rem",
    fontSize: 13,
    textTransform: "capitalize",
    color: tokens.foreground,
  },
  chevron: { flexShrink: 0, color: muted },
  expression: {
    fontFamily: consts.mono,
    fontSize: 12,
  },
});

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
  const { anchorRef, container } = useEditorPortal();

  if (field.type === "enum") {
    const items = (field.options ?? []).map((option) => ({ value: option, label: option }));
    const current = value || String(field.default ?? field.options?.[0] ?? "");
    return (
      <label {...stylex.props(styles.field)}>
        <span {...stylex.props(styles.label)}>{label}</span>
        <Select.Root
          items={items}
          value={current}
          onValueChange={(next) => onChange(next as string)}
        >
          <Select.Trigger
            ref={anchorRef}
            {...stylex.props(chrome.button, styles.select, chrome.focusRing)}
          >
            <Select.Value />
            <ChevronDown size={13} {...stylex.props(styles.chevron)} />
          </Select.Trigger>
          <Select.Portal container={container}>
            <Select.Positioner sideOffset={4} alignItemWithTrigger={false}>
              <Select.Popup {...stylex.props(chrome.popup)}>
                {items.map((item) => (
                  <Select.Item key={item.value} value={item.value} {...stylex.props(chrome.item)}>
                    <Select.ItemText>{item.label}</Select.ItemText>
                    <Select.ItemIndicator {...stylex.props(chrome.itemIndicator)}>
                      <Check size={14} />
                    </Select.ItemIndicator>
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
      <label {...stylex.props(styles.row)}>
        <span {...stylex.props(styles.label)}>{label}</span>
        <Switch.Root
          {...stylex.props(chrome.button, chrome.switchRoot)}
          checked={checked}
          onCheckedChange={(next) => onChange(next ? "true" : "false")}
        >
          <Switch.Thumb {...stylex.props(chrome.switchThumb)} />
        </Switch.Root>
      </label>
    );
  }

  if (field.type === "expression") {
    return (
      <label {...stylex.props(styles.field)}>
        <span {...stylex.props(styles.label)}>{label}</span>
        <input
          {...stylex.props(chrome.input, chrome.field, styles.expression)}
          value={value}
          spellCheck={false}
          placeholder={field.placeholder ?? "{…}"}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    );
  }

  return (
    <label {...stylex.props(styles.field)}>
      <span {...stylex.props(styles.label)}>{label}</span>
      <input
        {...stylex.props(chrome.input, chrome.field)}
        type={field.type === "number" ? "number" : "text"}
        value={value}
        placeholder={field.placeholder ?? label}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
