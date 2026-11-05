import { SettingsFrame } from '../components/SettingsForms.js';

/** Settings (J18): the header and tabs stay put while the section routes swap below them. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <SettingsFrame>{children}</SettingsFrame>;
}
