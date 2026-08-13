import { useEffect, useRef, useState } from "react";

interface Props {
  value: string;
  onCommit: (value: string) => void;
  align?: "left" | "right";
  placeholder?: string;
  inputMode?: "text" | "numeric" | "decimal";
  className?: string;
}

/** Cel die je aanklikt en direct typt, zoals in Excel. */
export function InlineCel({ value, onCommit, align = "left", placeholder, inputMode = "text", className }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (editing) ref.current?.select();
  }, [editing]);

  const base = `w-full px-1 py-0.5 ${align === "right" ? "text-right tabular-nums" : "text-left"} ${className ?? ""}`;

  if (!editing) {
    return (
      <button
        type="button"
        className={`${base} truncate hover:bg-accent/60 focus:bg-accent focus:outline-none`}
        onClick={() => setEditing(true)}
        onFocus={() => setEditing(true)}
      >
        {value || <span className="text-muted-foreground/50">{placeholder ?? "—"}</span>}
      </button>
    );
  }

  return (
    <input
      ref={ref}
      inputMode={inputMode}
      className={`${base} rounded-sm border border-primary bg-background outline-none`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          setEditing(false);
          if (draft !== value) onCommit(draft);
        } else if (e.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      }}
    />
  );
}
