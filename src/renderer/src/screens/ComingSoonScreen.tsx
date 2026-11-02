import type { View } from '../context'

/** Screens from the approved design whose features arrive in later milestones. */
const SCREENS: Partial<Record<View, { title: string; description: string; milestone: string }>> = {
  review: {
    title: 'Review queue',
    description:
      'AI suggestions from your emails, chats, transcripts, and Copilot summaries land here: new tasks, status updates, context-brief updates, and items that look done. Each shows where it came from. Nothing changes until you accept it.',
    milestone: 'Milestone 2: AI core (Claude provider, paste and import, extraction, review queue).',
  },
  prep: {
    title: 'Meeting prep',
    description: 'Before each meeting: open items with the attendees, recent decisions, and suggested talking points, pulled from your Outlook calendar and your archive.',
    milestone: 'Milestone 5: knowledge archive and meeting prep (needs the Outlook calendar from milestone 4).',
  },
  weekly: {
    title: 'Weekly review',
    description: "What you completed, what's new, what's slipping, and a status-report draft you can copy or save to Outlook drafts. Never sent automatically.",
    milestone: 'Milestone 3: priorities and briefings.',
  },
  archive: {
    title: 'Ask your archive',
    description: "Ask about anything you've worked on, even years ago. Answers cite the dated emails, transcripts, and tasks they came from.",
    milestone: 'Milestone 5: knowledge archive (full-text and semantic search, archive chat).',
  },
  import: {
    title: 'Import',
    description: 'Scan Outlook, paste a Copilot weekly summary, Teams chat, or transcript, or drop transcript files. The AI turns them into suggestions for your review queue.',
    milestone: 'Milestone 2 adds paste and file import; milestone 4 adds Outlook scanning.',
  },
}

export function ComingSoonScreen({ view }: { view: View }) {
  const screen = SCREENS[view]
  if (!screen) return null
  return (
    <div className="page" style={{ maxWidth: 760, marginLeft: 0 }}>
      <div className="head">
        <h1>{screen.title}</h1>
      </div>
      <p style={{ lineHeight: 1.7, marginTop: 0 }}>{screen.description}</p>
      <div className="ai">
        <div style={{ fontSize: 12, color: 'var(--accent)', marginBottom: 2 }}>Coming soon</div>
        {screen.milestone}
      </div>
    </div>
  )
}
