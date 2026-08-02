"use client";

import { DetectorPage } from "@/components/DetectorPage";
import { ENERGY } from "@/lib/detectors";

export default function EnergyBasedPage() {
  return <DetectorPage detector={ENERGY} />;
}
