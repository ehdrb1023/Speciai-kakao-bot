// 팔레트 토큰 (globals.css :root 와 동일 값 유지). 인라인 스타일용.
export const tokens = {
  color: {
    blue: '#1558E0',
    blueDark: '#1247BC',
    blueBg: '#E9F0FE',
    g900: '#191F28',
    g700: '#4E5968',
    g500: '#8B95A1',
    g200: '#E5E8EB',
    g100: '#F2F4F6',
    g50: '#F9FAFB',
    bg: '#F2F4F7',
    line: '#F0F2F4',
    green: '#0E9F54',
    red: '#D64550',
    orange: '#B26D00',
  },
  radius: { sm: 6, md: 10, lg: 16, pill: 999 },
  space: (n: number) => `${n * 4}px`,
} as const;

export {
  StatusChip,
  StatCard,
  Banner,
  SectionCard,
  DataTable,
  WizardSteps,
  Modal,
  type ChipTone,
  type StatTone,
  type BannerTone,
  type Column,
  type WizardStep,
} from './components/Primitives';
export { SignInForm } from './components/AuthForms';
export { MembersPanel, type MemberRow, type InvitationRow } from './components/MembersPanel';
export * from './components/Icons';
