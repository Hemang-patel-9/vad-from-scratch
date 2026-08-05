"use client";

import { DetectorPage } from "@/components/DetectorPage";
import { NEURAL } from "@/lib/detectors";

export default function DlBasedPage() {
  return <DetectorPage detector={NEURAL} />;
}
