import { useEffect, useState } from 'react'

import { toArabicDigits } from '@mushaf/core'

import type { FontFile } from './fonts.ts'
import { downloadFonts, type DownloadProgress } from './platform-tauri.ts'

const megabytes = (bytes: number) => toArabicDigits((bytes / 1048576).toFixed(1))

/**
 * First launch: the Mushaf's page fonts (about 93 MB) download once, then the app
 * works offline. Shown until every font is in place.
 */
export function FontSetup({ files, onReady }: { files: FontFile[]; onReady: () => void }) {
  const [progress, setProgress] = useState<DownloadProgress>()
  const [error, setError] = useState<string>()
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let isCurrent = true
    setError(undefined)
    downloadFonts(files, next => isCurrent && setProgress(next))
      .then(() => isCurrent && onReady())
      .catch((failure: unknown) => isCurrent && setError(String(failure)))

    return () => {
      isCurrent = false
    }
  }, [files, onReady, attempt])

  const share = progress && progress.total_bytes > 0 ? progress.bytes / progress.total_bytes : 0
  const total = files.reduce((sum, file) => sum + file.size, 0)

  return (
    <div className="setup" dir="rtl">
      <div className="setup-card">
        <svg className="setup-star" viewBox="0 0 40 40" aria-hidden="true">
          <path d="M20 2l5.3 7.2 8.9-1.4-1.4 8.9L40 20l-7.2 5.3 1.4 8.9-8.9-1.4L20 40l-5.3-7.2-8.9 1.4 1.4-8.9L0 20l7.2-5.3-1.4-8.9 8.9 1.4z" />
        </svg>
        <h1>تجهيز المصحف</h1>
        <p>
          يُحمَّل خط مصحف المدينة من مجمع الملك فهد مرة واحدة ({megabytes(total)} م.ب)، ثم يعمل المصحف دون اتصال
          بالإنترنت.
        </p>
        <div className="setup-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
          <span style={{ width: `${share * 100}%` }} />
        </div>
        <div className="setup-numbers">
          <span>{toArabicDigits(Math.round(share * 100))}٪</span>
          <span>
            {megabytes(progress?.bytes ?? 0)} / {megabytes(progress?.total_bytes ?? total)} م.ب
          </span>
        </div>
        {error ? (
          <div className="setup-error">
            <p>تعذّر التحميل. تأكد من الاتصال بالإنترنت ثم أعد المحاولة.</p>
            <code dir="ltr">{error}</code>
            <button type="button" onClick={() => setAttempt(count => count + 1)}>
              أعد المحاولة
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
