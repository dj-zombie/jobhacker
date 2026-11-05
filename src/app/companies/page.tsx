import { EmptyState, PageHeader } from '@/components/jobhacker';
import { Images, TriangleAlert } from 'lucide-react';
import { MobileNavButton } from '../../components/app-shell.js';
import { CompanyLogos } from '../components/CompanyLogos.js';
import { brandfetchClientId, getLogoCompanies, getUiConfig } from '../lib/queries.js';

export const dynamic = 'force-dynamic';

/** Company logos (J10): confirm, change or clear a domain for each company in the logo set. */
export default function CompaniesPage() {
  const config = getUiConfig();
  if (!config.ok) {
    return (
      <>
        <PageHeader
          icon={Images}
          kicker="Setup"
          title="Company logos"
          art="/art/deck-alien.webp"
          leading={<MobileNavButton />}
        />
        <EmptyState icon={TriangleAlert} title="The config has an error" body={config.error} />
      </>
    );
  }
  return <CompanyLogos rows={getLogoCompanies(config)} clientId={brandfetchClientId()} />;
}
