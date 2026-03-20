import type { ReactNode } from 'react'

interface FieldProps {
    label: ReactNode
    htmlFor: string
    hint?: ReactNode
    error?: ReactNode
    required?: boolean
    children: ReactNode
}

export function Field({
    label,
    htmlFor,
    hint,
    error,
    required = false,
    children,
}: FieldProps) {
    return (
        <div className="space-y-2">
            <label htmlFor={htmlFor} className="flex items-center gap-2 text-sm font-semibold text-text-base">
                <span>{label}</span>
                {required ? <span className="text-xs font-medium text-primary-base">必填</span> : null}
            </label>
            {children}
            {hint ? <p id={`${htmlFor}-hint`} className="text-xs leading-6 text-text-subtle">{hint}</p> : null}
            {error ? <p id={`${htmlFor}-error`} className="text-xs leading-6 text-danger-base">{error}</p> : null}
        </div>
    )
}
