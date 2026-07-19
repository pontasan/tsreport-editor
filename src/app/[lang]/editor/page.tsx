import CsrfGuard from "@/lib/client/components/system/csrf_guard"
import ErrorBoundary from "@/lib/server/exception/error_boundary"
import Auth from "@/lib/server/sc/auth"
import { Suspense } from "react"
import Form from "./form"

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
    const { lang } = await params
    await Auth({ lang })

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
