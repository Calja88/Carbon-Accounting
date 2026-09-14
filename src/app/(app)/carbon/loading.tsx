import { RouteSkeleton } from "@/components/ui/primitives";

export default function Loading() {
  return <RouteSkeleton title="the emissions dashboard" cards={4} rows={8} />;
}
