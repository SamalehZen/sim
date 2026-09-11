import { redirect } from 'next/navigation'

/** HyperFix chat-light : pas de site marketing, la racine va au workspace. */
export default function RootPage() {
  redirect('/workspace')
}
