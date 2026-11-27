import type {InputHTMLAttributes, ReactNode} from 'react';

interface FloatingFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'placeholder'> {
  readonly id: string;
  readonly label: string;
  readonly hint?: ReactNode;
}

/**
 * Field whose label rests inside the control and lifts into a notch on focus or when filled,
 * so the control keeps a single quiet border and the label never doubles up.
 */
export function FloatingField({id, label, hint, className = '', ...inputProps}: FloatingFieldProps) {
  return (
    <div className="app-float-field">
      <input
        {...inputProps}
        id={id}
        placeholder=" "
        className={`app-float-input ${className}`}
      />
      <label htmlFor={id} className="app-float-label">
        {label}
      </label>
      {hint ? <p className="mt-1.5 text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  );
}
