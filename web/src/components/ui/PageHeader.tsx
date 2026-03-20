import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface PageHeaderProps {
    eyebrow?: ReactNode
    title: ReactNode
    description?: ReactNode
    actions?: ReactNode
    meta?: ReactNode
    className?: string
}

export function PageHeader({
    eyebrow,
    title,
    description,
    actions,
    meta,
    className,
}: PageHeaderProps) {
    return (
        <header className={cn('page-header', className)}>
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div className="space-y-4">
                    {eyebrow ? <p className="page-header-eyebrow">{eyebrow}</p> : null}
                    <div className="space-y-3">
                        <h1 className="page-header-title">{title}</h1>
                        {description ? <p className="page-header-copy">{description}</p> : null}
                    </div>
                </div>
                {actions ? <div className="flex flex-wrap gap-2 lg:max-w-xl lg:justify-end">{actions}</div> : null}
            </div>
            {meta ? <div className="toolbar">{meta}</div> : null}
        </header>
    )
}
