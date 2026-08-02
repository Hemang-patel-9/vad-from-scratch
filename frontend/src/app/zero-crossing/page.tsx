"use client";

import { DetectorPage } from "@/components/DetectorPage";
import { ZERO_CROSSING } from "@/lib/detectors";

export default function ZeroCrossingPage() {
  return <DetectorPage detector={ZERO_CROSSING} />;
}
