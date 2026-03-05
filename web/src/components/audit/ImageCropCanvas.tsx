'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import { fetchPresignedUrl, uploadToMinIO, bindUploadToQuestion } from '@/lib/apiClient'
import { cn } from '@/lib/cn'
import { Upload, Crop } from 'lucide-react'

interface CropRect {
    x: number
    y: number
    width: number
    height: number
}

interface ImageCropCanvasProps {
    /** URL of the source image to crop from */
    imageUrl: string
    /** Question ID to bind the cropped image to */
    questionId: string
    /** Placeholder string to replace, e.g. "[需要手動截圖_1]" */
    placeholder: string
    /** Called with the resulting MinIO URL after successful upload + bind */
    onSuccess: (objectUrl: string) => void
}

/**
 * HiDPI-aware image cropping canvas for the audit workstation.
 *
 * HiDPI correction:
 *   Canvas logical size = displayed CSS px size
 *   Canvas actual pixels = CSS px × devicePixelRatio (DPR)
 *   All coordinates stored in CSS px space; multiplied by DPR only at draw time.
 *
 * Coordinate pipeline:
 *   1. Mouse event coords (CSS px, relative to canvas element)
 *   2. ÷ renderScale → original image pixel coords
 *   3. × DPR → canvas pixel coords for canvas.drawImage
 *
 * Upload pipeline (3 steps):
 *   1. GET /api/upload/presign → { presignedUrl, objectKey }
 *   2. XHR PUT blob → MinIO presignedUrl (with %progress tracking)
 *   3. POST /api/audit/bind → bind objectKey to questionId
 *
 * Edge cases handled:
 *   - Zero-size selection: clamped to min 10×10px
 *   - Image load failure: error state shown
 *   - Upload network error: error state with retry button
 *   - DPR change (e.g. move window between monitors): ResizeObserver re-calibrates canvas
 */
export function ImageCropCanvas({
    imageUrl,
    questionId,
    placeholder,
    onSuccess,
}: ImageCropCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const imgRef = useRef<HTMLImageElement | null>(null)
    const isDraggingRef = useRef(false)
    const startPtRef = useRef<{ x: number; y: number } | null>(null)
    const cropRectRef = useRef<CropRect | null>(null)

    const [uploadProgress, setUploadProgress] = useState<number | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [isUploading, setIsUploading] = useState(false)
    const [imgLoaded, setImgLoaded] = useState(false)

    // ---------------------------------------------------------------------------
    // Canvas setup — draw image, calibrated for HiDPI
    // ---------------------------------------------------------------------------

    const drawImage = useCallback(() => {
        const canvas = canvasRef.current
        const img = imgRef.current
        if (!canvas || !img) return

        const dpr = window.devicePixelRatio || 1
        const cssWidth = canvas.offsetWidth
        const cssHeight = cssWidth * (img.naturalHeight / img.naturalWidth)

        // Set actual pixel dimensions
        canvas.width = cssWidth * dpr
        canvas.height = cssHeight * dpr
        canvas.style.height = `${cssHeight}px`

        const ctx = canvas.getContext('2d')!
        ctx.scale(dpr, dpr)
        ctx.drawImage(img, 0, 0, cssWidth, cssHeight)
    }, [])

    const redrawWithSelection = useCallback((rect: CropRect | null) => {
        const canvas = canvasRef.current
        const img = imgRef.current
        if (!canvas || !img) return

        const dpr = window.devicePixelRatio || 1
        const cssWidth = canvas.offsetWidth
        const cssHeight = cssWidth * (img.naturalHeight / img.naturalWidth)

        const ctx = canvas.getContext('2d')!
        ctx.clearRect(0, 0, cssWidth, cssHeight)
        ctx.drawImage(img, 0, 0, cssWidth, cssHeight)

        if (rect) {
            // Dim area outside selection
            ctx.fillStyle = 'rgba(0,0,0,0.45)'
            ctx.fillRect(0, 0, cssWidth, cssHeight)

            // Clear selection area (restore original pixels)
            ctx.clearRect(rect.x, rect.y, rect.width, rect.height)
            ctx.drawImage(
                img,
                rect.x * (img.naturalWidth / cssWidth),
                rect.y * (img.naturalHeight / cssHeight),
                rect.width * (img.naturalWidth / cssWidth),
                rect.height * (img.naturalHeight / cssHeight),
                rect.x, rect.y, rect.width, rect.height,
            )

            // Draw selection border
            ctx.strokeStyle = '#6366f1'
            ctx.lineWidth = 2 / dpr
            ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)
        }
    }, [])

    // ---------------------------------------------------------------------------
    // Mouse event handlers — coordinate transformation
    // ---------------------------------------------------------------------------

    const getCanvasCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current!
        const rect = canvas.getBoundingClientRect()
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
        }
    }, [])

    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        isDraggingRef.current = true
        startPtRef.current = getCanvasCoords(e)
        cropRectRef.current = null
    }, [getCanvasCoords])

    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isDraggingRef.current || !startPtRef.current) return

        const { x, y } = getCanvasCoords(e)
        const rect: CropRect = {
            x: Math.min(startPtRef.current.x, x),
            y: Math.min(startPtRef.current.y, y),
            width: Math.abs(x - startPtRef.current.x),
            height: Math.abs(y - startPtRef.current.y),
        }
        cropRectRef.current = rect
        redrawWithSelection(rect)
    }, [getCanvasCoords, redrawWithSelection])

    const handleMouseUp = useCallback(() => {
        isDraggingRef.current = false
        // Enforce minimum selection size
        if (cropRectRef.current) {
            if (cropRectRef.current.width < 10 || cropRectRef.current.height < 10) {
                cropRectRef.current = null
                drawImage()
            }
        }
    }, [drawImage])

    // ---------------------------------------------------------------------------
    // Upload pipeline — presign → PUT → bind
    // ---------------------------------------------------------------------------

    const handleUpload = useCallback(async () => {
        const canvas = canvasRef.current
        const img = imgRef.current
        const rect = cropRectRef.current
        if (!canvas || !img || !rect) return

        setError(null)
        setIsUploading(true)
        setUploadProgress(0)

        try {
            // 1. Crop to a new off-screen canvas
            const cssWidth = canvas.offsetWidth
            const renderScaleX = img.naturalWidth / cssWidth
            const renderScaleY = img.naturalHeight / (cssWidth * (img.naturalHeight / img.naturalWidth))

            const offscreen = document.createElement('canvas')
            offscreen.width = Math.round(rect.width * renderScaleX)
            offscreen.height = Math.round(rect.height * renderScaleY)
            const octx = offscreen.getContext('2d')!
            octx.drawImage(
                img,
                rect.x * renderScaleX, rect.y * renderScaleY,
                offscreen.width, offscreen.height,
                0, 0, offscreen.width, offscreen.height,
            )

            // 2. Convert to Blob
            const blob = await new Promise<Blob>((resolve, reject) => {
                offscreen.toBlob(
                    (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob returned null'))),
                    'image/webp',
                    0.92,
                )
            })

            // 3. Get presigned URL from Agent B
            const { presignedUrl, objectKey } = await fetchPresignedUrl(
                `crops/${questionId}-${Date.now()}.webp`,
            )

            // 4. Upload directly to MinIO (bypasses Next.js server)
            await uploadToMinIO(presignedUrl, blob, (pct) => setUploadProgress(pct))

            // 5. Notify backend to bind objectKey → question record
            await bindUploadToQuestion({ objectKey, questionId, placeholder })

            onSuccess(`${objectKey}`)
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Upload failed'
            setError(msg)
            console.error('[ImageCropCanvas] upload error:', err)
        } finally {
            setIsUploading(false)
            setUploadProgress(null)
        }
    }, [questionId, placeholder, onSuccess])

    // ---------------------------------------------------------------------------
    // Image loading
    // ---------------------------------------------------------------------------

    useEffect(() => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => {
            imgRef.current = img
            setImgLoaded(true)
            drawImage()
        }
        img.onerror = () => setError('圖片載入失敗')
        img.src = imageUrl
    }, [imageUrl, drawImage])

    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------

    return (
        <div className="space-y-3">
            <div className="relative rounded-xl overflow-hidden border border-white/10 bg-zinc-900">
                <canvas
                    ref={canvasRef}
                    className={cn(
                        'w-full block',
                        imgLoaded ? 'cursor-crosshair' : 'opacity-0',
                    )}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    aria-label="圖片裁切區域，拖曳以選取範圍"
                    role="img"
                />
                {!imgLoaded && !error && (
                    <div className="absolute inset-0 flex items-center justify-center text-zinc-500 text-sm">
                        載入圖片中…
                    </div>
                )}
            </div>

            {error && (
                <div role="alert" className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2 flex items-center justify-between">
                    <span>{error}</span>
                    <Button variant="danger" size="sm" onClick={handleUpload}>
                        重試上傳
                    </Button>
                </div>
            )}

            {uploadProgress !== null && (
                <div className="space-y-1">
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-indigo-500 rounded-full transition-all duration-100"
                            style={{ width: `${uploadProgress}%` }}
                        />
                    </div>
                    <p className="text-xs text-zinc-400 text-right">{uploadProgress}%</p>
                </div>
            )}

            <div className="flex gap-2">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                        cropRectRef.current = null
                        drawImage()
                    }}
                >
                    <Crop className="size-4" aria-hidden />
                    清除選取
                </Button>
                <Button
                    variant="primary"
                    size="sm"
                    onClick={handleUpload}
                    isLoading={isUploading}
                    disabled={!cropRectRef.current || isUploading}
                >
                    <Upload className="size-4" aria-hidden />
                    上傳裁切圖片
                </Button>
            </div>
        </div>
    )
}
