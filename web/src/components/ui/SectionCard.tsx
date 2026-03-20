'use client'

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface SectionCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
    title?: ReactNode
    description?: ReactNode
    actions?: ReactNode
}

export const SectionCard = forwardRef<HTMLDivElement, SectionCardProps>(function SectionCard(
    { title, description, actions, className, children, ...props },
    ref,
) {
    return (
        <section ref={ref} className={cn('section-card space-y-5', className)} {...props}>
            {title || description || actions ? (
                <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-2">
                        {title ? <h2 className="font-heading text-xl font-semibold text-text-base">{title}</h2> : null}
                        {description ? <p className="max-w-3xl text-sm leading-7 text-text-muted">{description}</p> : null}
                    </div>
                    {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
                </header>
            ) : null}
            {children}
        </section>
    )
})
