import { RouteSkeleton } from "@/components/ui/primitives";

export default function Loading() {
  return <RouteSkeleton title="the collection plan" cards={7} rows={6} />;
}
