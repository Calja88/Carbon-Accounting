import { RouteSkeleton } from "@/components/ui/primitives";

export default function Loading() {
  return <RouteSkeleton title="this report" cards={4} rows={8} />;
}
