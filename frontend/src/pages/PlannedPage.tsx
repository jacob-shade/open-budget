import type { NavItem } from '../nav'
import { Icon } from '../components/Icon'

/** Placeholder for a section that's in the menu but not built yet. */
export function PlannedPage({ item }: { item: NavItem }) {
  return (
    <main>
      <section className="panel planned">
        <span className="planned-icon">
          <Icon name={item.icon} size={28} />
        </span>
        <h2>{item.label} isn't built yet</h2>
        <p className="muted-text">{item.planned}</p>
      </section>
    </main>
  )
}
