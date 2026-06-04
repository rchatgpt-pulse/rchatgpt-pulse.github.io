import { useState, useEffect } from 'react';

export interface SectionDef {
  id: string;
  label: string;
}

interface Props {
  sections: SectionDef[];
  /** "floating" (default) renders the fixed-position dot-nav on the right edge of
   *  the viewport. "inline" renders the same active-tracked list as a static
   *  block, intended for embedding in a site rail. */
  variant?: 'floating' | 'inline';
  /** Notified whenever the active section changes. Lets a parent gate
   *  surrounding rail content (e.g. a "Sections" header) on the same
   *  tracking the nav already does. */
  onActiveChange?: (id: string) => void;
}

export default function SectionNav({ sections, variant = 'floating', onActiveChange }: Props) {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? '');

  useEffect(() => {
    const elements = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);

    if (!elements.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible.length > 0) {
          const nextId = visible[0].target.id;
          setActiveId(nextId);
          onActiveChange?.(nextId);
        }
      },
      {
        rootMargin: '-10% 0px -60% 0px',
        threshold: 0,
      },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections, onActiveChange]);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  // Hide the floating nav while the user is on the very first section
  // (overview / hero). Inline variant always shows.
  const hidden = variant === 'floating' && activeId === sections[0]?.id;
  const containerClass =
    variant === 'inline'
      ? 'flex flex-col gap-0'
      : `fixed right-6 top-1/2 -translate-y-1/2 z-40 hidden xl:flex flex-col gap-1 transition-opacity duration-300 ${
          hidden ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`;

  // Tighter vertical rhythm for the inline rail; floating dot-nav keeps its
  // generous tap targets.
  const buttonPaddingY = variant === 'inline' ? 'py-0.5' : 'py-1.5';

  return (
    <nav className={containerClass}>
      {sections.map((s) => {
        const isActive = s.id === activeId;
        return (
          <button
            key={s.id}
            onClick={() => scrollTo(s.id)}
            className={`group flex items-center gap-3 ${buttonPaddingY} text-left`}
          >
            <span
              className={`w-2 h-2 rounded-full transition-all ${
                isActive
                  ? 'bg-accent-600 scale-125'
                  : 'bg-neutral-400 group-hover:bg-text-secondary'
              }`}
            />
            <span
              className={`text-xs transition-colors whitespace-nowrap ${
                isActive
                  ? 'text-accent-600 font-medium'
                  : 'text-text-muted group-hover:text-text-secondary'
              }`}
            >
              {s.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
