import App from '@/lib/client/components/system/app';
import type { Metadata } from 'next';
import localFont from 'next/font/local';
import 'primeicons/primeicons.css';
import 'primereact/resources/primereact.min.css';
// import 'primereact/resources/themes/lara-light-blue/theme.css';
import { I18NUtils } from '@/lib/server/i18n/i18n_utils';
import { getLanguageDirection, isSupportedLanguage } from '@/lib/common/i18n/languages';
import { notFound } from 'next/navigation';
import 'primereact/resources/themes/saga-blue/theme.css';
import './globals.css';

const notoSansJp = localFont({
  src: './fonts/NotoSansJP-VariableFont_wght.ttf',
  variable: '--font-noto-sans',
  weight: '100 900'
})

export const metadata: Metadata = {
  title: 'tsreport',
  description: 'tsreport Report Design Studio',
}

export default async function RootLayout({
  children,
  params
}: Readonly<{
  children: React.ReactNode,
  params: Promise<{ lang: string }>
}>) {
  const { lang } = await params
  if (!isSupportedLanguage(lang)) notFound()
  const dictionary = await I18NUtils.getClientDictionary(lang)

  return (
    <html lang={lang} dir={getLanguageDirection(lang)}>
      <body className={`${notoSansJp.variable}`}>
        <App lang={lang} dictionary={dictionary}>{children}</App>
      </body>
    </html>
  );
}
