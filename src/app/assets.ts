// Asset manifest (iwsdk.config.json "assets.module"). Evaluated by the app and by IWSDK's editor,
// so it must stay free of side effects.
import { AssetType, defineAssets } from "@iwsdk/core";

const ui = (file: string, name: string) => ({
  url: `${import.meta.env.BASE_URL}ui/${file}`,
  type: AssetType.UIKitML,
  name,
});

export default defineAssets({
  "home-panel": ui("home.uikitml", "Home Panel"),
  "settings-panel": ui("settings.uikitml", "Settings Panel"),
});
