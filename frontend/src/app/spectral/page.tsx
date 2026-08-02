"use client";

import { DetectorPage } from "@/components/DetectorPage";
import { SPECTRAL } from "@/lib/detectors";

export default function SpectralPage() {
  return <DetectorPage detector={SPECTRAL} />;
}
