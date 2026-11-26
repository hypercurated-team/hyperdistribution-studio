import { requireOptionalNativeModule } from "expo-modules-core";

/** What the phone itself sees in one photo or video poster frame. Nothing leaves the phone. */
export type Insight = {
  id: string;
  labels: { name: string; conf: number }[];
  faces: number;
  /** 0 (poor) to 1 (great): sharpness and exposure, plus Apple's aesthetics score where available. */
  quality: number;
  isScreenshot: boolean;
  isBlurry: boolean;
  isUtility?: boolean;
  error?: string;
};

type Native = { analyze(ids: string[]): Promise<Insight[]> };
const native = requireOptionalNativeModule<Native>("HmVision");

/** null on builds made before the module existed. */
export const HmVision = native;
