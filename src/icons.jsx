// Small inline icons for the header, menu and footer. They follow the text
// color and add no library or extra request.
const base = {
  width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false'
}

export const SearchIcon = props => <svg {...base} {...props}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l5 5" /></svg>
export const BagIcon = props => <svg {...base} {...props}><path d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8z" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" /></svg>
export const UserIcon = props => <svg {...base} {...props}><circle cx="12" cy="8.5" r="3.6" /><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" /></svg>
export const MenuIcon = props => <svg {...base} {...props}><path d="M4 7h16M4 12h16M4 17h10" /></svg>
export const CloseIcon = props => <svg {...base} {...props}><path d="M6 6l12 12M18 6L6 18" /></svg>
export const SunIcon = props => <svg {...base} {...props}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" /></svg>
export const MoonIcon = props => <svg {...base} {...props}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>
export const ArrowIcon = props => <svg {...base} {...props}><path d="M7 17 17 7M9 7h8v8" /></svg>
export const LiteIcon = props => <svg {...base} {...props}><path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z" /></svg>
