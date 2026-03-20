'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/Button'
import { Loader2, Image as ImageIcon } from 'lucide-react'
import { fetchPresignedUrl, uploadToMinIO } from '@/lib/apiClient'
import { log } from '@/lib/logger'
import { useFeedback } from '@/components/ui/FeedbackProvider'

interface QuestionImageUploaderProps {
    onUploadComplete: (url: string) => void
}

export function QuestionImageUploader({ onUploadComplete }: QuestionImageUploaderProps) {
    const { notify } = useFeedback()
    const [isUploading, setIsUploading] = useState(false)
    const [progress, setProgress] = useState<number | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        setIsUploading(true)
        setProgress(0)

        try {
            // 1. Get presigned URL
            const ext = file.name.split('.').pop() || 'png'
            const res = await fetchPresignedUrl(`manual-crops/${Date.now()}.${ext}`)
            const { uploadUrl, objectKey, publicUrl } = res as any

            // 2. Upload file
            await uploadToMinIO(uploadUrl, file, (pct) => setProgress(pct))

            // 3. Emit the public URL
            onUploadComplete(publicUrl || objectKey)

        } catch (err) {
            log.error('image-upload', 'Upload failed', { error: err })
            notify({
                tone: 'error',
                title: '上傳失敗，請重試',
            })
        } finally {
            setIsUploading(false)
            setProgress(null)
            if (fileInputRef.current) {
                fileInputRef.current.value = ''
            }
        }
    }

    return (
        <div className="flex flex-col gap-2">
            <input
                type="file"
                accept="image/*"
                className="hidden"
                ref={fileInputRef}
                onChange={handleFileChange}
            />
            <Button
                variant="secondary"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="w-fit"
            >
                {isUploading ? (
                    <Loader2 className="size-4 animate-spin mr-2" />
                ) : (
                    <ImageIcon className="size-4 mr-2" />
                )}
                {isUploading ? `上傳中 ${progress ?? 0}%` : '上傳截圖'}
            </Button>
        </div>
    )
}
