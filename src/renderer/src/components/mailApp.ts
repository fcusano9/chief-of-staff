import { useEffect, useState } from 'react'
import type { MailApp } from '@shared/types'
import { cos } from '../api'

/** "Mail" or "Outlook", as buttons say it ("Open in Mail", "Save to Outlook Drafts"). */
export const mailAppName = (app: MailApp | null | undefined) => (app === 'apple-mail' ? 'Mail' : 'Outlook')

let known: MailApp | null | undefined

/** The mail app this computer reads (Outlook on Windows, Apple Mail on the Mac), asked once. */
export function useMailApp(): MailApp | null {
  const [app, setApp] = useState<MailApp | null>(known ?? null)
  useEffect(() => {
    if (known !== undefined) return
    void cos['mail.info']().then((i) => {
      known = i.app
      setApp(i.app)
    })
  }, [])
  return app
}
