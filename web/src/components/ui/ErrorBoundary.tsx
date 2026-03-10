'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './Button'
import { log } from '@/lib/logger'

interface ErrorBoundaryProps {
    children: ReactNode
    fallback?: ReactNode
    /** Called when an error is caught — use for structured logging */
    onError?: (error: Error, info: ErrorInfo) => void
}

interface ErrorBoundaryState {
    hasError: boolean
    error: Error | null
}

/**
 * React class-based Error Boundary.
 *
 * Catches rendering errors in the subtree and displays a fallback UI.
 * Provides a "重試" button to reset state and re-attempt rendering.
 *
 * Usage:
 *   <ErrorBoundary onError={logger.captureError}>
 *     <RelatedQuestions />
 *   </ErrorBoundary>
 *
 * Edge cases:
 *  - Errors in async event handlers are NOT caught (those must be try/caught
 *    manually and set via local state or toast notifications).
 *  - Errors in the fallback itself will propagate to a parent ErrorBoundary.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props)
        this.state = { hasError: false, error: null }
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error }
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        // Structured log — include component stack for traceability
        log.error('error-boundary', 'Caught error', {
            message: error.message,
            stack: error.stack,
            componentStack: info.componentStack,
        })
        this.props.onError?.(error, info)
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null })
    }

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) return this.props.fallback

            return (
                <div
                    role="alert"
                    className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center space-y-3"
                >
                    <p className="text-sm text-red-300 font-medium">載入失敗</p>
                    <p className="text-xs text-red-400/70 font-mono break-all">
                        {this.state.error?.message}
                    </p>
                    <Button variant="danger" size="sm" onClick={this.handleReset}>
                        重試
                    </Button>
                </div>
            )
        }

        return this.props.children
    }
}
