'use client'

import { SystemAction } from '@/lib/client/components/system/action'
import { useSystem } from '@/lib/client/components/system/hooks'
import { localizePathname, SUPPORTED_LANGUAGES, type LanguageCode } from '@/lib/common/i18n/languages'
import { APP_VERSION } from '@/lib/common/version'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import SelectDropdown from './editor/select_dropdown'
import styles from './form.module.css'

type State = {
    userId: string
    password: string
}

export default function Form() {
    const [sysState, sysDispatch] = useSystem()
    const ui = sysState.dictionary.ui
    const [state, setState] = useState<State>({
        userId: '',
        password: ''
    })
    const [providers, setProviders] = useState<{ google: boolean, microsoft: boolean }>({ google: false, microsoft: false })
    const userIdRef = useRef<HTMLInputElement>(null)
    const userPwRef = useRef<HTMLInputElement>(null)
    const pathname = usePathname()
    const langCode = sysState.lang

    function changeLanguage(code: LanguageCode) {
        if (code !== langCode) {
            window.location.href = localizePathname(pathname, code) + window.location.search + window.location.hash
        }
    }

    // Show external sign-in buttons only for providers an administrator enabled.
    useEffect(function () {
        fetch('/api/auth/oauth/providers').then(function (res) { return res.json() }).then(setProviders).catch(function () {})
    }, [])

    function handleLogin() {
        SystemAction.login(sysDispatch, state.userId, state.password)
    }

    function startExternal(provider: 'google' | 'microsoft') {
        window.location.href = `/api/auth/oauth/${provider}/start?lang=${encodeURIComponent(langCode)}`
    }

    return (
        <div className={styles.background}>
            <div className={styles.card}>
                <div className={styles.logoArea}>
                    <div className={styles.logoIcon}>
                        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                            <rect x="2" y="4" width="20" height="26" rx="2" stroke="currentColor" strokeWidth="2" />
                            <rect x="10" y="2" width="20" height="26" rx="2" fill="currentColor" opacity="0.15" stroke="currentColor" strokeWidth="2" />
                            <line x1="14" y1="10" x2="26" y2="10" stroke="currentColor" strokeWidth="1.5" />
                            <line x1="14" y1="14" x2="24" y2="14" stroke="currentColor" strokeWidth="1.5" />
                            <line x1="14" y1="18" x2="22" y2="18" stroke="currentColor" strokeWidth="1.5" />
                        </svg>
                    </div>
                    <h1 className={styles.title}>tsreport</h1>
                    <p className={styles.subtitle}>{ui.brandSubtitle}</p>
                </div>

                <div className={styles.formArea}>
                    <div className={styles.fieldGroup}>
                        <label className={styles.label} htmlFor="login-id">{ui.loginId}</label>
                        <div className={styles.inputWrap}>
                            <i className={`pi pi-user ${styles.inputIcon}`}></i>
                            <input
                                ref={userIdRef}
                                id="login-id"
                                type="text"
                                className={styles.input}
                                value={state.userId}
                                autoComplete="username"
                                onKeyDown={function (e) {
                                    if (e.key === 'Enter') userPwRef.current?.focus()
                                }}
                                onChange={function (e) {
                                    setState({ ...state, userId: e.target.value })
                                }}
                            />
                        </div>
                    </div>

                    <div className={styles.fieldGroup}>
                        <label className={styles.label} htmlFor="login-pw">{ui.password}</label>
                        <div className={styles.inputWrap}>
                            <i className={`pi pi-lock ${styles.inputIcon}`}></i>
                            <input
                                ref={userPwRef}
                                id="login-pw"
                                type="password"
                                className={styles.input}
                                value={state.password}
                                autoComplete="current-password"
                                onKeyDown={function (e) {
                                    if (e.key === 'Enter') handleLogin()
                                }}
                                onChange={function (e) {
                                    setState({ ...state, password: e.target.value })
                                }}
                            />
                        </div>
                    </div>

                    <button className={styles.loginButton} onClick={handleLogin}>
                        {ui.login}
                    </button>

                    {(providers.google || providers.microsoft) && (
                        <>
                            <div className={styles.externalDivider}><span>{ui.or}</span></div>
                            {providers.google && (
                                <button className={styles.externalButton} onClick={function () { startExternal('google') }}>
                                    <i className="pi pi-google"></i>{ui.signInGoogle}
                                </button>
                            )}
                            {providers.microsoft && (
                                <button className={styles.externalButton} onClick={function () { startExternal('microsoft') }}>
                                    <i className="pi pi-microsoft"></i>{ui.signInMicrosoft}
                                </button>
                            )}
                            <p className={styles.externalNote}>
                                {ui.externalAccountNote}
                            </p>
                        </>
                    )}
                </div>

                <div className={styles.langFooter}>
                    <i className={`pi pi-globe ${styles.langGlobe}`}></i>
                    <SelectDropdown
                        className={styles.langSelect}
                        value={langCode}
                        onChange={function (e) { changeLanguage(e.target.value as LanguageCode) }}
                    >
                        {SUPPORTED_LANGUAGES.map(function (l) {
                            return <option key={l.code} value={l.code}>{l.label}</option>
                        })}
                    </SelectDropdown>
                </div>

                <div className={styles.versionLabel}>tsreport v{APP_VERSION}</div>
            </div>
        </div>
    )
}
