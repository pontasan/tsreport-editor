import CsrfGuard from '@/lib/client/components/system/csrf_guard'
import ErrorBoundary from '@/lib/server/exception/error_boundary'
import { Suspense } from 'react'
import Form from './form'

export default function Page() {
  return (
    <ErrorBoundary>
      <Suspense>
        <CsrfGuard>
          <Form />
        </CsrfGuard>
      </Suspense>
    </ErrorBoundary>
  )
}
