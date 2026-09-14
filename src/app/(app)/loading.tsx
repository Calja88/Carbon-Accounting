import { RouteSkeleton } from "@/components/ui/primitives";

export default function Loading() {
  return <RouteSkeleton title="the overview" cards={4} rows={6} />;
}
