import { requireOptionalNativeModule } from "expo";

type HjLive = { start(text: string): boolean; lockIn(index: number): boolean; close(): boolean };

/** Calls into HJBridge (targets/widget/_shared). Null in Expo Go or on Android. */
export default requireOptionalNativeModule<HjLive>("HjLive");
