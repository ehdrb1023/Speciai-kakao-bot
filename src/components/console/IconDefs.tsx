// 콘솔 SVG symbol defs. 각 뷰가 <use href="#i-*"/> 로 참조.
// 한 번만 렌더. 셸 최상단에 배치.
export function IconDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <symbol id="i-doc" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"/><path d="M14 3.5V8h4"/><path d="M9.5 12.5h5.5M9.5 16h5.5"/></symbol>
        <symbol id="i-pen" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m14.5 5.5 4 4L9 19l-5 1 1-5 9.5-9.5Z"/><path d="m13 7 4 4"/></symbol>
        <symbol id="i-case" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="7.5" width="17" height="12" rx="2.5"/><path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5"/><path d="M3.5 12.5h17"/><path d="M12 11.5v2"/></symbol>
        <symbol id="i-bubble" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4c-4.8 0-8.5 3-8.5 6.8 0 2.3 1.4 4.3 3.6 5.5L6.3 20l4-2c.6.1 1.1.1 1.7.1 4.8 0 8.5-3 8.5-6.8S16.8 4 12 4Z"/></symbol>
        <symbol id="i-bldg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 20.5V5a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 16 5v15.5"/><path d="M16 9.5h2.5A1.5 1.5 0 0 1 20 11v9.5"/><path d="M8.3 7.5h1.6M11.6 7.5h1.6M8.3 11h1.6M11.6 11h1.6M8.3 14.5h1.6M11.6 14.5h1.6"/><path d="M3.5 20.5h17"/></symbol>
        <symbol id="i-folder" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7Z"/></symbol>
        <symbol id="i-gear" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v2.3M12 18.2v2.3M3.5 12h2.3M18.2 12h2.3M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18"/></symbol>
        <symbol id="i-id" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="8.6" cy="11" r="2"/><path d="M6 16.2c.5-1.5 1.5-2.2 2.6-2.2s2.1.7 2.6 2.2"/><path d="M14.5 9.5H18M14.5 13H18"/></symbol>
        <symbol id="i-collect" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.5v9.5"/><path d="m8.5 9.5 3.5 3.5 3.5-3.5"/><path d="M4 14.5v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></symbol>
        <symbol id="i-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></symbol>
        <symbol id="i-cal" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/></symbol>
        <symbol id="i-bot" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="8.5" width="14" height="10" rx="3"/><path d="M12 8.5V5.5"/><circle cx="12" cy="4.2" r="1.3"/><path d="M9.2 13.2h.01M14.8 13.2h.01" strokeWidth="2.6"/></symbol>
        <symbol id="i-stampic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 10.5V7a3 3 0 1 1 6 0v3.5"/><path d="M6.5 10.5h11l1 4.5h-13l1-4.5Z"/><path d="M5 19h14"/></symbol>
        <symbol id="i-shield" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.5 5 6v5.5c0 4.4 3 7.5 7 9 4-1.5 7-4.6 7-9V6l-7-2.5Z"/><path d="m9.3 12 2 2 3.6-3.8"/></symbol>
        <symbol id="i-search" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></symbol>
        <symbol id="i-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 1 1 7 0v2.5"/></symbol>
        <symbol id="i-clock" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/></symbol>
        <symbol id="i-download" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.5v11"/><path d="m8 11 4 4 4-4"/><path d="M4.5 19.5h15"/></symbol>
        <symbol id="i-trash" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 7h15"/><path d="M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2"/><path d="M6.5 7l.8 12a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.8l.8-12"/><path d="M10 11v6M14 11v6"/></symbol>
        <symbol id="i-refresh" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/></symbol>
        <symbol id="i-book" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15.5H7.5A2.5 2.5 0 0 0 5 21V5.5Z"/><path d="M5 18.5A2.5 2.5 0 0 1 7.5 16H19"/></symbol>
        <symbol id="i-law" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.5v17M7 20.5h10"/><path d="M12 5.5 5.5 8M12 5.5 18.5 8"/><path d="M3.5 13a2.8 2.8 0 0 0 5.6 0L6.3 8 3.5 13ZM14.9 13a2.8 2.8 0 0 0 5.6 0L17.7 8l-2.8 5Z"/></symbol>
        <symbol id="i-flag" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 21V4"/><path d="M6 5c4-2.2 8 2 12 0v8c-4 2.2-8-2-12 0"/></symbol>
        <symbol id="i-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12c2.4-4.2 5.4-6.3 9-6.3S18.6 7.8 21 12c-2.4 4.2-5.4 6.3-9 6.3S5.4 16.2 3 12Z"/><circle cx="12" cy="12" r="2.6"/></symbol>
        <symbol id="i-back" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m14.5 5.5-6.5 6.5 6.5 6.5"/></symbol>
        <symbol id="i-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9.5 5.5 6.5 6.5-6.5 6.5"/></symbol>
        <symbol id="i-chevd" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5.5 9.5 6.5 6.5 6.5-6.5"/></symbol>
        <symbol id="i-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5.5v13M5.5 12h13"/></symbol>
        <symbol id="i-minus" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5.5 12h13"/></symbol>
        <symbol id="i-print" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 8V4h10v4"/><rect x="4" y="8" width="16" height="8" rx="1.8"/><path d="M7 13.5h10V20H7v-6.5Z"/></symbol>
        <symbol id="i-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M5.5 14.5h-1v-9a1 1 0 0 1 1-1h9v1"/></symbol>
        <symbol id="i-al-l" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M4.5 6.5h15M4.5 12h9M4.5 17.5h13"/></symbol>
        <symbol id="i-al-c" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M4.5 6.5h15M7.5 12h9M5.5 17.5h13"/></symbol>
        <symbol id="i-al-j" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M4.5 6.5h15M4.5 12h15M4.5 17.5h15"/></symbol>
      </defs>
    </svg>
  );
}

// <use href> 헬퍼 — 목업 ic(id,w) 대응
export function Ic({ id, w = 14 }: { id: string; w?: number }) {
  return (
    <svg width={w} height={w}>
      <use href={`#${id}`} />
    </svg>
  );
}
