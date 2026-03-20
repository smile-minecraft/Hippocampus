'use client'

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant
    size?: ButtonSize
    isLoading?: boolean
    children: ReactNode
}

const variantStyles: Record<ButtonVariant, string> = {
    primary:
        'bg-cta-base text-cta-foreground border border-transparent hover:bg-cta-hover focus-visible:ring-[var(--focus-ring)] shadow-elevation-1',
    secondary:
        'bg-surface-base text-text-base border border-border-base hover:bg-surface-muted hover:border-border-hover focus-visible:ring-[var(--focus-ring)] shadow-sm',
    ghost:
        'text-text-muted hover:text-text-base hover:bg-bg-surface focus-visible:ring-[var(--focus-ring)]',
    danger:
        'bg-danger-base text-bg-surface hover:bg-danger-base/90 focus-visible:ring-[var(--focus-ring)] border border-transparent shadow-elevation-1',
}

const sizeStyles: Record<ButtonSize, string> = {
    sm: 'h-8 px-3 text-sm rounded-md gap-1.5',
    md: 'h-10 px-4 text-sm rounded-lg gap-2',
    lg: 'h-12 px-6 text-base rounded-xl gap-2',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    {
        variant = 'primary',
        size = 'md',
        isLoading = false,
        className,
        disabled,
        children,
        ...props
    },
    ref,
) {
    return (
        <button
            ref={ref}
            disabled={disabled || isLoading}
            aria-busy={isLoading}
            className={cn(
                'inline-flex items-center justify-center font-medium font-heading',
                'transition-all duration-200 ease-out',
                'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base hover:-translate-y-px active:translate-y-0',
                'disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none',
                variantStyles[variant],
                sizeStyles[size],
                className,
            )}
            {...props}
        >
            {isLoading ? (
                <span className="size-4 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden />
            ) : null}
            {children}
        </button>
    )
})
