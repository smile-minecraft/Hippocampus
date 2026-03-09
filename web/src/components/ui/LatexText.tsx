'use client'

import { useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

interface LatexTextProps {
    children: string
    className?: string
    /** If true, render as editable-friendly plain text (no HTML injection) */
    plainFallback?: boolean
}

/**
 * LatexText — renders inline LaTeX ($...$) within mixed text.
 *
 * Splits the input string on `$...$` delimiters, renders matched segments
 * through KaTeX, and returns the rest as plain text spans.
 *
 * Thread-safe: KaTeX.renderToString is a pure function with no shared state.
 */
export function LatexText({ children, className, plainFallback }: LatexTextProps) {
    const rendered = useMemo(() => {
        if (!children) return ''
        if (plainFallback) return children

        // Split on $...$ (non-greedy, single-line)
        // Captures both the delimiter groups and the text between them
        const parts: Array<{ type: 'text' | 'latex'; content: string }> = []
        const regex = /\$([^$]+?)\$/g
        let lastIndex = 0
        let match: RegExpExecArray | null

        while ((match = regex.exec(children)) !== null) {
            // Push text before this match
            if (match.index > lastIndex) {
                parts.push({ type: 'text', content: children.slice(lastIndex, match.index) })
            }
            parts.push({ type: 'latex', content: match[1] })
            lastIndex = regex.lastIndex
        }

        // Push remaining text
        if (lastIndex < children.length) {
            parts.push({ type: 'text', content: children.slice(lastIndex) })
        }

        // If no LaTeX found, return plain text
        if (parts.every(p => p.type === 'text')) {
            return null // signal to use plain render
        }

        return parts.map((part, i) => {
            if (part.type === 'text') {
                return part.content
            }
            try {
                const html = katex.renderToString(part.content, {
                    throwOnError: false,
                    displayMode: false,
                    trust: true,
                    strict: false,
                })
                return `<span class="katex-inline">${html}</span>`
            } catch {
                // Fallback: just show the raw text if KaTeX fails
                return `$${part.content}$`
            }
        }).join('')
    }, [children, plainFallback])

    if (!children) return null

    // No LaTeX detected — plain text
    if (rendered === null) {
        return <span className={className}>{children}</span>
    }

    return (
        <span
            className={className}
            dangerouslySetInnerHTML={{ __html: rendered }}
        />
    )
}
