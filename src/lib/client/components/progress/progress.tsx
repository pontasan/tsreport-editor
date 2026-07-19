'use client'

import styles from './progress.module.css'

export function Progress() {
    return (
        <div className={styles.overlay}>
            <div className={styles.spinner} />
        </div>
    )
}
