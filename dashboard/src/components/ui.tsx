import type React from "react";
import {
  Badge as MantineBadge,
  Button as MantineButton,
  Card as MantineCard,
  Group,
  NativeSelect,
  Text,
  Textarea as MantineTextarea,
  TextInput,
} from "@mantine/core";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function Button(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "secondary" | "danger" | "ghost";
    size?: "sm" | "md" | "icon";
  },
) {
  const {
    className,
    variant = "secondary",
    size = "md",
    children,
    ...rest
  } = props;
  const mantineVariant = variant === "primary"
    ? "filled"
    : variant === "ghost"
    ? "subtle"
    : "default";
  const color = variant === "danger"
    ? "red"
    : variant === "primary"
    ? "blue"
    : "gray";
  return (
    <MantineButton
      color={color}
      radius="md"
      size={size === "sm" ? "xs" : "sm"}
      variant={mantineVariant}
      className={cx(
        "tp-button",
        size === "icon" && "tp-button-icon",
        className,
      )}
      {...(rest as Record<string, unknown>)}
    >
      {children}
    </MantineButton>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <TextInput
      radius="md"
      size="sm"
      className={cx(
        "tp-input",
        props.className,
      )}
      {...(props as Record<string, unknown>)}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <NativeSelect
      radius="md"
      size="sm"
      className={cx(
        "tp-input",
        props.className,
      )}
      {...(props as Record<string, unknown>)}
    >
      {props.children}
    </NativeSelect>
  );
}

export function Textarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  const { className, ...rest } = props;
  return (
    <MantineTextarea
      radius="md"
      size="sm"
      autosize={false}
      className="tp-input"
      classNames={{
        input: cx("tp-textarea-input", className),
      }}
      {...(rest as Record<string, unknown>)}
    />
  );
}

export function Badge(
  { children, tone = "muted", className, title }: {
    children: React.ReactNode;
    tone?: "success" | "danger" | "info" | "warning" | "muted";
    className?: string;
    title?: string;
  },
) {
  const color = tone === "success"
    ? "green"
    : tone === "danger"
    ? "red"
    : tone === "info"
    ? "blue"
    : tone === "warning"
    ? "orange"
    : "gray";
  return (
    <MantineBadge
      title={title}
      color={color}
      radius="xl"
      size="sm"
      variant="light"
      className={cx(
        "tp-badge",
        className,
      )}
    >
      {children}
    </MantineBadge>
  );
}

export function Card(
  { children, className }: { children: React.ReactNode; className?: string },
) {
  return (
    <MantineCard
      radius="md"
      withBorder
      shadow="xs"
      className={cx(
        "tp-card p-4",
        className,
      )}
    >
      {children}
    </MantineCard>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <MantineCard
      radius="md"
      withBorder
      className="flex min-h-32 items-center justify-center border-dashed bg-[var(--tp-panel-muted)] p-6"
    >
      <Text size="sm" c="dimmed" ta="center">{children}</Text>
    </MantineCard>
  );
}

export function MetricChip(
  { label, value }: { label: string; value: string | number },
) {
  return (
    <MantineCard
      radius="md"
      withBorder
      className="bg-[var(--tp-panel-muted)] p-2"
    >
      <Text size="xs" c="dimmed">{label}</Text>
      <Text size="sm" fw={700} mt={4}>{value}</Text>
    </MantineCard>
  );
}

export function SectionTitle(
  { title, description, action }: {
    title: string;
    description?: string;
    action?: React.ReactNode;
  },
) {
  return (
    <Group justify="space-between" align="flex-start" gap="sm" className="mb-3">
      <div className="min-w-0">
        <Text fw={700} size="sm" c="var(--tp-ink)">{title}</Text>
        {description && (
          <Text c="dimmed" size="xs" mt={4} lh={1.6}>{description}</Text>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </Group>
  );
}
