"use client";

import { useState } from "react";
import { EyeIcon, EyeOffIcon } from "@/components/icons";

/** Password box with a show/hide button and a Caps Lock warning. */
export function PasswordInput({
  name,
  placeholder,
  autoComplete,
  minLength,
  hint,
  onValueChange,
}: {
  name: string;
  placeholder: string;
  autoComplete: "current-password" | "new-password";
  minLength?: number;
  hint?: React.ReactNode;
  onValueChange?: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const hintId = `${name}-hint`;
  const checkCaps = (e: React.KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState?.("CapsLock") ?? false);

  return (
    <div className="pw-wrap">
      <div className="pw-field">
        <input
          type={visible ? "text" : "password"}
          name={name}
          placeholder={placeholder}
          autoComplete={autoComplete}
          minLength={minLength}
          required
          aria-label={placeholder}
          aria-describedby={hint || capsLock ? hintId : undefined}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={checkCaps}
          onKeyUp={checkCaps}
          onBlur={() => setCapsLock(false)}
          onChange={(e) => onValueChange?.(e.target.value)}
        />
        <button
          type="button"
          className="pw-toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          title={visible ? "Hide password" : "Show password"}
        >
          {visible ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
        </button>
      </div>
      {(capsLock || hint) && (
        <div id={hintId} className="pw-hint">
          {capsLock && <span className="pw-caps">Caps Lock is on.</span>}
          {hint && <span>{hint}</span>}
        </div>
      )}
    </div>
  );
}
