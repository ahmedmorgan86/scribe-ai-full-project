'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  {
    href: '/',
    label: 'Home',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
        />
      </svg>
    ),
  },
  {
    href: '/queue',
    label: 'Queue',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
        />
      </svg>
    ),
  },
  {
    href: '/posts-ready',
    label: 'Posts Ready',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
        />
      </svg>
    ),
  },
  {
    href: '/knowledge',
    label: 'Knowledge Base',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
        />
      </svg>
    ),
  },
  {
    href: '/config',
    label: 'Config',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
        />
      </svg>
    ),
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
    ),
  },
];

export function Sidebar(): React.ReactElement {
  const pathname = usePathname();
  const router = useRouter();
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const navRef = useRef<HTMLElement>(null);
  const linkRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  const activeIndex = navItems.findIndex((item) => item.href === pathname);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent): void => {
      const isNavFocused = navRef.current?.contains(document.activeElement) === true;
      if (!isNavFocused) {
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
        case 'j': {
          e.preventDefault();
          const nextIndex = focusedIndex < navItems.length - 1 ? focusedIndex + 1 : 0;
          setFocusedIndex(nextIndex);
          linkRefs.current[nextIndex]?.focus();
          break;
        }
        case 'ArrowUp':
        case 'k': {
          e.preventDefault();
          const prevIndex = focusedIndex > 0 ? focusedIndex - 1 : navItems.length - 1;
          setFocusedIndex(prevIndex);
          linkRefs.current[prevIndex]?.focus();
          break;
        }
        case 'Enter': {
          if (focusedIndex >= 0 && focusedIndex < navItems.length) {
            e.preventDefault();
            router.push(navItems[focusedIndex].href);
          }
          break;
        }
        case 'Home': {
          e.preventDefault();
          setFocusedIndex(0);
          linkRefs.current[0]?.focus();
          break;
        }
        case 'End': {
          e.preventDefault();
          const lastIndex = navItems.length - 1;
          setFocusedIndex(lastIndex);
          linkRefs.current[lastIndex]?.focus();
          break;
        }
      }
    },
    [focusedIndex, router]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return (): void => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  useEffect(() => {
    setFocusedIndex(activeIndex >= 0 ? activeIndex : 0);
  }, [activeIndex]);

  return (
    <aside className="hidden md:flex md:w-64 md:flex-col bg-gray-800 border-r border-gray-700">
      <div className="flex h-16 items-center justify-center border-b border-gray-700">
        <h1 className="text-xl font-bold text-white">AI Social Engine</h1>
      </div>
      <nav ref={navRef} className="flex-1 px-4 py-6 space-y-2" role="navigation" aria-label="Main">
        {navItems.map((item, index) => {
          const isActive = pathname === item.href;
          const isFocused = focusedIndex === index;
          return (
            <Link
              key={item.href}
              href={item.href}
              ref={(el): void => {
                linkRefs.current[index] = el;
              }}
              tabIndex={isFocused ? 0 : -1}
              onFocus={(): void => setFocusedIndex(index)}
              className={`flex items-center space-x-3 px-3 py-2 rounded-lg transition-colors outline-none ${
                isActive
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-400 hover:bg-gray-700 hover:text-white'
              } ${isFocused ? 'ring-2 ring-blue-500 ring-inset' : ''}`}
              aria-current={isActive ? 'page' : undefined}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
