import { useState, useEffect } from 'react';
import { useWindowDimensions } from 'react-native';

export type Breakpoint = 'xs' | 'sm' | 'md' | 'lg';

const BREAKPOINTS = {
  sm: 640,
  md: 1024,
  lg: 1440,
} as const;

function getBreakpoint(width: number): Breakpoint {
  if (width >= BREAKPOINTS.lg) return 'lg';
  if (width >= BREAKPOINTS.md) return 'md';
  if (width >= BREAKPOINTS.sm) return 'sm';
  return 'xs';
}

export function useBreakpoint() {
  const { width } = useWindowDimensions();
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(getBreakpoint(width));

  useEffect(() => {
    setBreakpoint(getBreakpoint(width));
  }, [width]);

  return {
    breakpoint,
    width,
    isMobile: breakpoint === 'xs' || breakpoint === 'sm',
    isDesktop: breakpoint === 'md' || breakpoint === 'lg',
    isLargeDesktop: breakpoint === 'lg',
    sidebarWidth: breakpoint === 'lg' ? 220 : 64,
  };
}

export { BREAKPOINTS };
