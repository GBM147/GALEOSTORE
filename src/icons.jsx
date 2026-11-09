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
export const TruckIcon = props => <svg {...base} {...props}><path d="M3 6.5h11v9H3zM14 9.5h3.6l3.4 3.4v2.6h-7" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></svg>
export const ShieldIcon = props => <svg {...base} {...props}><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6z" /><path d="m9 12 2.2 2.2L15.5 10" /></svg>
export const SparkleIcon = props => <svg {...base} {...props}><path d="M12 3.5 13.8 10.2 20.5 12l-6.7 1.8L12 20.5l-1.8-6.7L3.5 12l6.7-1.8z" /></svg>
export const StarIcon = props => <svg {...base} {...props}><path d="m12 3.8 2.5 5.3 5.8.7-4.3 4 1.1 5.7L12 16.7l-5.1 2.8 1.1-5.7-4.3-4 5.8-.7z" /></svg>
export const RefreshIcon = props => <svg {...base} {...props}><path d="M20 11a8 8 0 0 0-14.6-4.4M4 4.5V8.5h4M4 13a8 8 0 0 0 14.6 4.4M20 19.5v-4h-4" /></svg>
export const CheckIcon = props => <svg {...base} {...props}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
export const LockIcon = props => <svg {...base} {...props}><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></svg>
export const CardIcon = props => <svg {...base} {...props}><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="M3 10h18M7 15h4" /></svg>
export const QrIcon = props => <svg {...base} {...props}><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" /><path d="M14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM14 18.5V20M20 14v1.5" /></svg>
