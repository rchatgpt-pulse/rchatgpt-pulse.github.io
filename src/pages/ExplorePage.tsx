import { useData } from '../data/useData';
import ExploreSection from '../sections/ExploreSection';

/** Standalone route for the feature explorer. Linked to from the final
 *  button page in <ScrollyHero />. */
export default function ExplorePage() {
  const { loading } = useData();

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen text-text-muted">Loading...</div>;
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-bg px-4 md:px-10 py-8">
      <div className="mx-auto w-full max-w-5xl">
        <ExploreSection />
      </div>
    </div>
  );
}
