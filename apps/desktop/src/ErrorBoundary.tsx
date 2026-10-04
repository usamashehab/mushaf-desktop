import { Component, type ReactNode } from 'react'

/** If the reader ever throws, show what happened and a way back, never a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  override state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override render() {
    const { error } = this.state
    if (!error) {
      return this.props.children
    }

    return (
      <div className="setup" dir="rtl">
        <div className="setup-card">
          <h1>حدث خطأ</h1>
          <p>نعتذر، تعطّل العرض. أعد التحميل للمتابعة من حيث توقفت.</p>
          <code dir="ltr" className="crash">{error.message}</code>
          <div className="setup-error-actions">
            <button type="button" onClick={() => window.location.reload()}>
              أعد التحميل
            </button>
          </div>
        </div>
      </div>
    )
  }
}
