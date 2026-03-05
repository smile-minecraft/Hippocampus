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
        'bg-cta-base text-white border border-transparent hover:bg-cta-hover focus-visible:ring-cta-base/50',
    secondary:
        'bg-transparent text-primary-base border-2 border-primary-base hover:bg-primary-base/10 focus-visible:ring-primary-base/50',
    ghost:
        'text-text-muted hover:text-text-base hover:bg-border-base focus-visible:ring-border-base',
    danger:
        'bg-red-600/90 text-white hover:bg-red-500 focus-visible:ring-red-500/50 border border-transparent',
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
                'transition-all duration-250 ease-out will-change-transform',
                'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base hover:-translate-y-px active:translate-y-0',
                'disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none',
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
